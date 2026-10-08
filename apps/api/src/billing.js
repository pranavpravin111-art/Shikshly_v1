/**
 * Pure billing rules (no database, no network) so they are easy to read and to unit-test.
 *
 *   monthly charge = max(active students x price per student, minimum monthly charge)
 */
export const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Amount in paise for one month. Falls back to a flat monthly price if no per-student price is set. */
export function monthlyChargePaise({ activeStudents = 0, pricePerStudentPaise = null, minimumMonthlyPaise = null, monthlyPaise = null }) {
    const students = Math.max(0, Math.floor(Number(activeStudents) || 0));
    if (pricePerStudentPaise > 0)
        return Math.max(students * pricePerStudentPaise, minimumMonthlyPaise || 0);
    return monthlyPaise > 0 ? monthlyPaise : 0;
}

/** True when the plan has a price, so a school can actually be billed for it. */
export const isPlanPriced = (plan) => !!plan && (plan.pricePerStudentPaise > 0 || plan.monthlyPaise > 0);

/** Trial start/end. A school gets the free trial only once; later subscriptions are billed straight away. */
export function trialWindow({ now = new Date(), trialDays = 30, alreadyHadTrial = false }) {
    if (alreadyHadTrial || !(trialDays > 0))
        return null;
    return { trialStart: now, trialEnd: new Date(now.getTime() + trialDays * DAY_MS) };
}

/**
 * Can this school use paid features right now?
 *  - free plan: always (it has no paid features anyway)
 *  - active / trial: until the period ends
 *  - past_due: still allowed for GRACE_DAYS after the period ended, so one failed payment does not lock a school out mid-week
 */
export function isSubscriptionUsable(sub, now = new Date()) {
    if (!sub)
        return false;
    if (sub.planKey === 'free')
        return ['active', 'trial'].includes(sub.status);
    if (!sub.periodEnd)
        return false;
    const end = new Date(sub.periodEnd).getTime();
    if (['active', 'trial'].includes(sub.status))
        return end > now.getTime();
    if (sub.status === 'past_due')
        return end + GRACE_DAYS * DAY_MS > now.getTime();
    return false;
}

/** Turns a Razorpay subscription event into the fields we store. Returns null for events we ignore. */
export function subscriptionUpdateFromEvent(event, entity) {
    const fromUnix = (v) => (v ? new Date(Number(v) * 1000) : undefined);
    const dates = { periodStart: fromUnix(entity?.current_start), periodEnd: fromUnix(entity?.current_end) };
    const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
    switch (event) {
        case 'subscription.activated':
        case 'subscription.charged':
        case 'subscription.resumed':
            return clean({ status: 'active', ...dates });
        case 'subscription.pending':
        case 'subscription.halted':
        case 'subscription.paused':
            return { status: 'past_due' };
        case 'subscription.cancelled':
            return { status: 'cancelled', autoRenew: false };
        case 'subscription.completed':
            return { status: 'expired', autoRenew: false };
        default:
            return null;
    }
}

/**
 * Subscriptions nobody is paying for any more. A daily job marks them "expired" so the database tells the truth.
 * (The app already blocks their features through isSubscriptionUsable; this is only tidying.)
 * Paid periods get 7 days for a late webhook before being expired.
 */
export function staleSubscriptionFilter(now = new Date()) {
    const ago = (days) => new Date(now.getTime() - days * DAY_MS);
    return { planKey: { $ne: 'free' }, $or: [
        { status: { $in: ['trial', 'active'] }, periodEnd: { $lt: ago(7) } },
        { status: 'past_due', periodEnd: { $lt: ago(GRACE_DAYS) } },
    ] };
}
