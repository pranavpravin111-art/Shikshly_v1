import { describe, expect, it } from 'vitest';
import { isEncrypted, packBackup, unpackBackup } from '../src/backup-lib.js';
import { dayKey, lastDates, lastMonths, percent, sumBy, weeksAgo } from '../src/insights-utils.js';
import { staleSubscriptionFilter } from '../src/billing.js';
import { notifyAlert } from '../src/alerts.js';

const data = { users: [{ _id: '1', name: 'A\tb' }, { _id: '2', name: 'ü' }], empty: [], schools: [{ _id: 'x', n: 1 }] };
const io = { serialize: JSON.stringify, deserialize: JSON.parse };

describe('backup file', () => {
    it('round-trips plain and encrypted', () => {
        for (const passphrase of ['', 'secret-pass']) {
            const file = packBackup(data, { ...io, passphrase });
            expect(isEncrypted(file)).toBe(!!passphrase);
            const back = unpackBackup(file, { ...io, passphrase });
            expect(back.users).toEqual(data.users);
            expect(back.schools).toEqual(data.schools);
        }
    });
    it('refuses a wrong or missing passphrase', () => {
        const file = packBackup(data, { ...io, passphrase: 'right' });
        expect(() => unpackBackup(file, { ...io, passphrase: 'wrong' })).toThrow(/Wrong passphrase/);
        expect(() => unpackBackup(file, io)).toThrow(/encrypted/);
    });
    it('detects a damaged file', () => {
        const file = Buffer.from(packBackup(data, { ...io, passphrase: 'right' }));
        file[60] ^= 1;
        expect(() => unpackBackup(file, { ...io, passphrase: 'right' })).toThrow();
    });
});

describe('graph date helpers (India time)', () => {
    const now = new Date('2026-10-07T10:00:00Z');
    it('dayKey follows IST (rolls over at 18:30 UTC)', () => { expect(dayKey(now)).toBe('2026-10-07'); expect(dayKey(new Date('2026-10-07T20:00:00Z'))).toBe('2026-10-08'); });
    it('lastDates ends today', () => { expect(lastDates(3, now)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']); });
    it('lastMonths crosses the year', () => { expect(lastMonths(3, now)).toEqual(['2026-08', '2026-09', '2026-10']); expect(lastMonths(3, new Date('2026-01-15T00:00:00Z'))).toEqual(['2025-11', '2025-12', '2026-01']); });
    it('weeksAgo counts whole weeks', () => { expect(weeksAgo(new Date('2026-10-05T10:00:00Z'), now)).toBe(0); expect(weeksAgo(new Date('2026-09-30T10:00:00Z'), now)).toBe(1); });
    it('percent and sumBy are safe', () => { expect(percent(3, 4)).toBe(75); expect(percent(1, 0)).toBeNull(); expect(sumBy([{ a: 1 }, { a: 2 }, {}], 'a')).toBe(3); });
});

describe('housekeeping', () => {
    it('stale-subscription filter never touches the free plan', () => { const f = staleSubscriptionFilter(new Date()); expect(f.planKey).toEqual({ $ne: 'free' }); expect(f.$or).toHaveLength(2); });
    it('alerts do nothing when no webhook is configured', async () => { expect(await notifyAlert('x', 'k', {})).toBe(false); });
});
