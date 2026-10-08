import { Router } from 'express';
import { z } from 'zod';
import { Plan, Student, Subscription } from '../models.js';
import { asyncRoute, audit } from '../helpers.js';
import { authenticate, requireRoles, requireTokenType } from '../middleware/auth.js';
import { isPlanPriced, isSubscriptionUsable, monthlyChargePaise, trialWindow } from '../billing.js';
import { getOrCreateRazorpayPlan, razorpay } from '../razorpay.js';

/**
 * School subscription billing (owner only).
 *   GET  /api/billing/status     current plan, trial/renewal dates and what the next bill will be
 *   POST /api/billing/subscribe  start the free trial (first time) or a paid plan; returns a Razorpay link to authorise payment
 *   POST /api/billing/cancel     stop renewing at the end of the paid period
 * Razorpay tells us about every later change through the webhook (see webhooks.routes.js).
 */
export const billingRouter = Router();
billingRouter.use(authenticate, requireTokenType('member'), requireRoles('owner'));

const activeStudents = () => Student.countDocuments({ status: 'active' });

billingRouter.get('/status', asyncRoute(async (_req, res) => {
    const sub = await Subscription.findOne({}).lean();
    const plan = sub ? await Plan.findOne({ key: sub.planKey }).lean() : null;
    const students = await activeStudents();
    res.json({
        subscription: sub, usable: isSubscriptionUsable(sub), activeStudents: students,
        nextChargePaise: plan ? monthlyChargePaise({ activeStudents: students, ...plan }) : 0,
    });
}));

// The paid plans with what THIS school would pay, for the billing screen.
billingRouter.get('/plans', asyncRoute(async (_req, res) => {
    const [plans, sub, students] = await Promise.all([Plan.find({ available: true, key: { $ne: 'free' } }).sort({ pricePerStudentPaise: 1 }).lean(), Subscription.findOne({}).lean(), activeStudents()]);
    res.json({ activeStudents: students, plans: plans.map(p => ({
        key: p.key, name: p.name, description: p.description, features: p.features, priced: isPlanPriced(p),
        estimatedMonthlyPaise: monthlyChargePaise({ activeStudents: students, ...p }), pricePerStudentPaise: p.pricePerStudentPaise, minimumMonthlyPaise: p.minimumMonthlyPaise,
        trialDays: sub?.trialStart ? 0 : p.trialDays, current: sub?.planKey === p.key,
    })) });
}));
billingRouter.post('/subscribe', asyncRoute(async (req, res) => {
    const body = z.object({ planKey: z.enum(['basic', 'standard', 'premium']) }).parse(req.body);
    const [sub, plan] = await Promise.all([Subscription.findOne({}), Plan.findOne({ key: body.planKey, available: true }).lean()]);
    if (!plan || !isPlanPriced(plan))
        return res.status(409).json({ message: 'This plan does not have a price yet. Please contact Shikshly support.' });
    if (sub?.providerSubscriptionId && ['active', 'trial', 'past_due'].includes(sub.status) && !sub.cancelAtPeriodEnd)
        return res.status(409).json({ message: 'This school already has a subscription. Cancel it first to switch plans.' });
    const students = await activeStudents();
    const amount = monthlyChargePaise({ activeStudents: students, ...plan });
    const trial = trialWindow({ trialDays: plan.trialDays, alreadyHadTrial: !!sub?.trialStart });
    // Razorpay plans are fixed-price, so we create one for this school's amount, then a subscription on it.
    const rzPlanId = await getOrCreateRazorpayPlan(`Shikshly ${plan.name}`, amount);
    const rzSub = await razorpay('POST', '/subscriptions', {
        plan_id: rzPlanId, total_count: 120, customer_notify: 1,
        ...(trial ? { start_at: Math.floor(trial.trialEnd.getTime() / 1000) } : {}),
        notes: { schoolId: req.auth.schoolId, planKey: plan.key },
    });
    const now = new Date();
    await Subscription.findOneAndUpdate({}, { $set: {
        planKey: plan.key, billingPeriod: 'monthly', providerSubscriptionId: rzSub.id, cancelAtPeriodEnd: false, autoRenew: true,
        billableStudentCount: students, pricePerStudentPaise: plan.pricePerStudentPaise || 0, minimumMonthlyPaise: plan.minimumMonthlyPaise || 0,
        // During the trial the school already gets the plan's features.
        ...(trial ? { status: 'trial', trialStart: trial.trialStart, trialEnd: trial.trialEnd, periodStart: now, periodEnd: trial.trialEnd } : {}),
    } }, { upsert: true });
    await audit(req, 'billing.subscribed', 'subscription', rzSub.id, { planKey: plan.key, amountPaise: amount, trial: !!trial });
    res.status(201).json({ providerSubscriptionId: rzSub.id, paymentLink: rzSub.short_url, trial: !!trial, trialEnd: trial?.trialEnd ?? null, firstChargePaise: amount });
}));

billingRouter.post('/cancel', asyncRoute(async (req, res) => {
    const sub = await Subscription.findOne({}).lean();
    if (!sub?.providerSubscriptionId)
        return res.status(409).json({ message: 'There is no paid subscription to cancel.' });
    await razorpay('POST', `/subscriptions/${sub.providerSubscriptionId}/cancel`, { cancel_at_cycle_end: 1 });
    await Subscription.updateOne({ _id: sub._id }, { $set: { cancelAtPeriodEnd: true, autoRenew: false } });
    await audit(req, 'billing.cancel_requested', 'subscription', sub.providerSubscriptionId);
    res.json({ cancelAtPeriodEnd: true });
}));
