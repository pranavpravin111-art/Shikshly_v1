/** Small date helpers for the role graphs (pure, so they are unit-tested). All dates are in the school's local time zone. */
const DAY_MS = 24 * 60 * 60 * 1000;
const parts = (date, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(p => [p.type, p.value]));

/** "2026-10-07" */
export const dayKey = (date, tz = 'Asia/Kolkata') => { const p = parts(new Date(date), tz); return `${p.year}-${p.month}-${p.day}`; };
/** "2026-10" */
export const monthKey = (date, tz = 'Asia/Kolkata') => dayKey(date, tz).slice(0, 7);

/** The last n days, oldest first, ending today. */
export const lastDates = (n, now = new Date(), tz = 'Asia/Kolkata') => Array.from({ length: n }, (_, i) => dayKey(new Date(now.getTime() - (n - 1 - i) * DAY_MS), tz));

/** The last n months as "YYYY-MM", oldest first, ending with the current month. */
export function lastMonths(n, now = new Date(), tz = 'Asia/Kolkata') {
    const [y, m] = monthKey(now, tz).split('-').map(Number);
    return Array.from({ length: n }, (_, i) => { const t = (y * 12 + (m - 1)) - (n - 1 - i); return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; });
}

/** 0 = this week, 1 = last week ... */
export const weeksAgo = (date, now = new Date()) => Math.floor((now.getTime() - new Date(date).getTime()) / (7 * DAY_MS));

export const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);
export const sumBy = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
