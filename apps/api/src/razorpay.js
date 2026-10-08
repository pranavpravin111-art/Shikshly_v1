import { RazorpayPlanCache } from './models.js';

/** Tiny Razorpay REST client (no SDK, so there is nothing extra to install). Used for school subscriptions. */
export const razorpayConfigured = (env = process.env) => !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);

export async function razorpay(method, path, body, env = process.env) {
    if (!razorpayConfigured(env))
        throw Object.assign(new Error('Online billing is not configured yet. Please contact Shikshly support.'), { statusCode: 503 });
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const response = await fetch(`https://api.razorpay.com/v1${path}`, {
        method, headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
        throw Object.assign(new Error(data?.error?.description || `Payment provider error (${response.status})`), { statusCode: 502 });
    return data;
}

/** One Razorpay plan per (name, amount): reused when another school pays the same price, so plans never pile up. */
export async function getOrCreateRazorpayPlan(name, amountPaise, env = process.env) {
    const key = `${name}:${amountPaise}`;
    const cached = await RazorpayPlanCache.findOne({ key }).lean();
    if (cached)
        return cached.planId;
    const plan = await razorpay('POST', '/plans', { period: 'monthly', interval: 1, item: { name, amount: amountPaise, currency: 'INR' } }, env);
    await RazorpayPlanCache.updateOne({ key }, { $setOnInsert: { key, planId: plan.id } }, { upsert: true });
    return plan.id;
}
