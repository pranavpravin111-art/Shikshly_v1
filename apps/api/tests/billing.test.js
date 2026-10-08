import { describe, expect, it } from 'vitest';
import { GRACE_DAYS, isPlanPriced, isSubscriptionUsable, monthlyChargePaise, subscriptionUpdateFromEvent, trialWindow } from '../src/billing.js';

const day = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-06T00:00:00Z');
const at = (days) => new Date(now.getTime() + days * day);

describe('monthly charge = max(students x price, minimum)', () => {
    it('charges per student', () => { expect(monthlyChargePaise({ activeStudents: 100, pricePerStudentPaise: 5000, minimumMonthlyPaise: 100000 })).toBe(500000); });
    it('never charges less than the minimum', () => { expect(monthlyChargePaise({ activeStudents: 10, pricePerStudentPaise: 5000, minimumMonthlyPaise: 100000 })).toBe(100000); });
    it('uses the flat monthly price when there is no per-student price', () => { expect(monthlyChargePaise({ activeStudents: 10, monthlyPaise: 99900 })).toBe(99900); });
    it('is zero for an unpriced plan', () => { expect(monthlyChargePaise({ activeStudents: 10 })).toBe(0); expect(isPlanPriced({})).toBe(false); });
    it('ignores nonsense student counts', () => { expect(monthlyChargePaise({ activeStudents: -5, pricePerStudentPaise: 100, minimumMonthlyPaise: 500 })).toBe(500); });
});

describe('free trial', () => {
    it('lasts the configured number of days', () => { expect(trialWindow({ now, trialDays: 30 }).trialEnd.toISOString()).toBe('2026-11-05T00:00:00.000Z'); });
    it('is given only once per school', () => { expect(trialWindow({ now, trialDays: 30, alreadyHadTrial: true })).toBeNull(); });
    it('can be turned off with 0 days', () => { expect(trialWindow({ now, trialDays: 0 })).toBeNull(); });
});

describe('who may use paid features', () => {
    const paid = (status, periodEnd) => ({ planKey: 'premium', status, periodEnd });
    it('active before the period ends', () => { expect(isSubscriptionUsable(paid('active', at(1)), now)).toBe(true); });
    it('not after the period ends', () => { expect(isSubscriptionUsable(paid('active', at(-1)), now)).toBe(false); });
    it('trial counts like active', () => { expect(isSubscriptionUsable(paid('trial', at(10)), now)).toBe(true); });
    it('past_due keeps working during the grace period', () => { expect(isSubscriptionUsable(paid('past_due', at(-(GRACE_DAYS - 1))), now)).toBe(true); });
    it('past_due stops after the grace period', () => { expect(isSubscriptionUsable(paid('past_due', at(-(GRACE_DAYS + 1))), now)).toBe(false); });
    it('cancelled and expired never work', () => { expect(isSubscriptionUsable(paid('cancelled', at(5)), now)).toBe(false); expect(isSubscriptionUsable(paid('expired', at(5)), now)).toBe(false); });
    it('a paid plan without an end date is not usable', () => { expect(isSubscriptionUsable({ planKey: 'basic', status: 'active', periodEnd: null }, now)).toBe(false); });
    it('the free plan is always usable while active', () => { expect(isSubscriptionUsable({ planKey: 'free', status: 'active', periodEnd: null }, now)).toBe(true); });
    it('no subscription means no access', () => { expect(isSubscriptionUsable(null, now)).toBe(false); });
});

describe('Razorpay subscription events', () => {
    it('a charge activates and stores the new period', () => {
        const u = subscriptionUpdateFromEvent('subscription.charged', { current_start: 1790000000, current_end: 1792592000 });
        expect(u.status).toBe('active');
        expect(u.periodEnd.getTime()).toBe(1792592000 * 1000);
    });
    it('a failed payment moves to past_due', () => { expect(subscriptionUpdateFromEvent('subscription.halted', {})).toEqual({ status: 'past_due' }); });
    it('cancel and complete stop renewal', () => { expect(subscriptionUpdateFromEvent('subscription.cancelled', {}).status).toBe('cancelled'); expect(subscriptionUpdateFromEvent('subscription.completed', {}).status).toBe('expired'); });
    it('unknown events are ignored', () => { expect(subscriptionUpdateFromEvent('subscription.something_new', {})).toBeNull(); });
});
