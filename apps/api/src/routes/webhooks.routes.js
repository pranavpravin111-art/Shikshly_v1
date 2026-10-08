import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import { FeeCharge, FeePayment, Plan, Student, Subscription, WebhookEvent } from '../models.js';
import { monthlyChargePaise, subscriptionUpdateFromEvent } from '../billing.js';
import { getOrCreateRazorpayPlan, razorpay, razorpayConfigured } from '../razorpay.js';
import { runInScope } from '../tenant-scope.js';
import { inTransaction } from '../db.js';
import { logger } from '../logger.js';
export const webhookRouter = Router();
webhookRouter.post('/razorpay', async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    const raw = req.rawBody;
    const received = String(req.headers['x-razorpay-signature'] || '');
    if (secret.length < 16 || !raw || !received)
        return res.status(503).json({ message: 'Razorpay webhook verification is not configured' });
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(received), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
        return res.status(401).json({ message: 'Invalid webhook signature' });
    const event = String(req.body?.event || '');
    // Razorpay retries webhooks; the event id lets us apply each one only once.
    const eventId = String(req.headers['x-razorpay-event-id'] || '');
    if (eventId) {
        try {
            await WebhookEvent.create({ eventId, source: 'razorpay', type: event });
        }
        catch (error) {
            if (error?.code === 11000)
                return res.json({ received: true, duplicate: true });
            throw error;
        }
    }
    const forgetEvent = () => eventId ? WebhookEvent.deleteOne({ eventId }).catch(() => undefined) : undefined;
    // Any failed answer (4xx/5xx) means Razorpay will retry, so the retry must not be skipped as a duplicate.
    res.on('finish', () => { if (res.statusCode >= 400)
        void forgetEvent(); });
    if (event.startsWith('subscription.')) {
        try {
            return res.json({ received: true, ...(await handleSubscriptionEvent(event, req.body?.payload?.subscription?.entity || {})) });
        }
        catch (error) {
            await forgetEvent(); // so Razorpay's retry is processed instead of being skipped as a duplicate
            logger.error({ err: error.message, event }, 'Razorpay subscription webhook failed');
            return res.status(500).json({ message: 'Subscription update failed; event can be retried' });
        }
    }
    const entity = req.body?.payload?.payment?.entity || req.body?.payload?.order?.entity || {};
    const orderId = String(entity.order_id || entity.id || '');
    if (!orderId)
        return res.status(400).json({ message: 'No provider order id' });
    const payment = await runInScope({ system: true }, () => FeePayment.findOne({ providerOrderId: orderId }).lean());
    if (!payment)
        return res.status(404).json({ message: 'Payment order not found' });
    if (payment.status === 'paid')
        return res.json({ received: true, duplicate: true });
    const successful = event === 'payment.captured' || event === 'order.paid';
    const failed = event === 'payment.failed';
    if (!successful && !failed)
        return res.json({ received: true, ignored: true });
    const scope = { schoolId: String(payment.schoolId) };
    try {
        await runInScope(scope, () => inTransaction(async (session) => {
            const current = await FeePayment.findById(payment._id).session(session ?? null);
            if (!current || current.status === 'paid')
                return;
            if (failed) {
                current.status = 'failed';
                current.providerPaymentId = String(entity.id || '');
                await current.save({ session });
                return;
            }
            if (Number(entity.amount) !== current.amountPaise || String(entity.currency || 'INR') !== 'INR')
                throw new Error('Razorpay payment amount or currency mismatch');
            for (const allocation of current.allocations) {
                const charge = await FeeCharge.findById(allocation.chargeId).session(session ?? null);
                if (!charge)
                    throw new Error('Related fee charge not found');
                charge.paidPaise = (charge.paidPaise || 0) + allocation.amountPaise;
                const due = (charge.amountPaise || 0) + (charge.finePaise || 0) - (charge.discountPaise || 0);
                charge.status = charge.paidPaise >= due ? 'paid' : 'partial';
                await charge.save({ session });
            }
            current.status = 'paid';
            current.providerPaymentId = String(entity.id || '');
            current.paidAt = new Date(Number(entity.created_at || Date.now() / 1000) * 1000);
            current.receiptNo = `R-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`;
            await current.save({ session });
        }));
    }
    catch (error) {
        await forgetEvent();
        logger.error({ err: error.message, orderId }, 'Razorpay webhook reconciliation failed');
        return res.status(500).json({ message: 'Payment reconciliation failed; event can be retried' });
    }
    res.json({ received: true, reconciled: successful });
});

/** Applies a Razorpay subscription event (trial started, renewed, payment failed, cancelled...) to the school's Subscription. */
async function handleSubscriptionEvent(event, entity) {
    const update = subscriptionUpdateFromEvent(event, entity);
    if (!update)
        return { ignored: true };
    const sub = entity.id ? await runInScope({ system: true }, () => Subscription.findOne({ providerSubscriptionId: entity.id }).lean()) : null;
    if (!sub)
        return { ignored: true, reason: 'unknown subscription' };
    const schoolId = String(sub.schoolId);
    // A trial school must not be moved to "active" by the authorisation event; only a real charge does that.
    if (event === 'subscription.activated' && sub.status === 'trial' && sub.trialEnd > new Date())
        return { ignored: true, reason: 'trial running' };
    await runInScope({ schoolId }, () => Subscription.updateOne({ _id: sub._id }, { $set: update }));
    if (event === 'subscription.charged')
        await scheduleNextAmount(schoolId, sub, entity).catch(error => logger.error({ err: error.message, schoolId }, 'Could not schedule next billing amount'));
    return { updated: Object.keys(update) };
}

/** After each charge, set the next month's price from the CURRENT number of active students (the billable snapshot). */
async function scheduleNextAmount(schoolId, sub, entity) {
    if (!razorpayConfigured() || !sub.pricePerStudentPaise)
        return;
    const plan = await Plan.findOne({ key: sub.planKey }).lean();
    const students = await runInScope({ schoolId }, () => Student.countDocuments({ status: 'active' }));
    const amount = monthlyChargePaise({ activeStudents: students, ...plan });
    const current = sub.billableStudentCount;
    await runInScope({ schoolId }, () => Subscription.updateOne({ _id: sub._id }, { $set: { billableStudentCount: students } }));
    if (students === current || !amount)
        return;
    const rzPlanId = await getOrCreateRazorpayPlan(`Shikshly ${plan.name}`, amount);
    await razorpay('PATCH', `/subscriptions/${entity.id}`, { plan_id: rzPlanId, schedule_change_at: 'cycle_end' });
}
