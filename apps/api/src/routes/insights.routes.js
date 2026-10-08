import { Router } from 'express';
import { AdmissionApplication, AdmissionInquiry, Attendance, Classroom, FeeCharge, FeePayment, LibraryBook, LibraryLoan, Student } from '../models.js';
import { asyncRoute } from '../helpers.js';
import { authenticate, requireTokenType } from '../middleware/auth.js';
import { dayKey, lastDates, lastMonths, monthKey, percent, sumBy, weeksAgo } from '../insights-utils.js';

/**
 * GET /api/insights : the numbers behind each role's graphs. The answer depends on who is signed in.
 * (Owner, principal and parent already have graphs through /school/dashboard and /learning.)
 * Everything is read through the normal tenant-scoped models, so a school only ever sees its own data.
 */
export const insightsRouter = Router();
insightsRouter.use(authenticate, requireTokenType('member'));

const builders = {
    async teacher(req) {
        const classes = await Classroom.find({ teacherIds: req.auth.sub }).lean();
        const dates = lastDates(7);
        return { classes: await Promise.all(classes.map(async (c) => {
            const [students, rows] = await Promise.all([Student.countDocuments({ classId: c._id, status: 'active' }), Attendance.find({ classId: c._id, date: { $in: dates } }, 'date status').lean()]);
            const days = dates.map(date => { const r = rows.filter(x => x.date === date), present = r.filter(x => ['present', 'late'].includes(x.status)).length; return { date, marked: r.length, present, rate: percent(present, r.length) }; });
            const today = days[days.length - 1];
            return { id: String(c._id), name: `${c.name}${c.section ? `-${c.section}` : ''}`, students, days, today: { present: today.present, absent: today.marked - today.present, notMarked: Math.max(0, students - today.marked) } };
        })) };
    },
    async accountant() {
        const months = lastMonths(6), since = new Date(`${months[0]}-01T00:00:00+05:30`), now = new Date();
        const [payments, charges] = await Promise.all([FeePayment.find({ status: 'paid', paidAt: { $gte: since } }, 'amountPaise paidAt').lean(), FeeCharge.find({}, 'amountPaise discountPaise finePaise paidPaise dueDate').limit(100000).lean()]);
        const monthly = months.map(month => ({ month, amountPaise: sumBy(payments.filter(p => p.paidAt && monthKey(p.paidAt) === month), 'amountPaise') }));
        const owed = charges.map(c => ({ due: c.dueDate, pending: Math.max(0, (c.amountPaise || 0) - (c.discountPaise || 0) + (c.finePaise || 0) - (c.paidPaise || 0)) }));
        return { monthly, collectedPaise: sumBy(charges, 'paidPaise'), pendingPaise: sumBy(owed, 'pending'), overduePaise: sumBy(owed.filter(o => o.due && o.due < now), 'pending') };
    },
    async admission_staff() {
        const now = new Date(), since = new Date(now.getTime() - 8 * 7 * 86400000);
        const [apps, inquiries] = await Promise.all([AdmissionApplication.find({}, 'status').lean(), AdmissionInquiry.find({ createdAt: { $gte: since } }, 'createdAt').lean()]);
        const byStatus = {};
        for (const a of apps)
            byStatus[a.status] = (byStatus[a.status] || 0) + 1;
        const weekly = Array.from({ length: 8 }, (_, i) => ({ weeksAgo: 7 - i, count: inquiries.filter(q => weeksAgo(q.createdAt, now) === 7 - i).length }));
        return { byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })), weekly, totalApplications: apps.length };
    },
    async librarian() {
        const months = lastMonths(6), since = new Date(`${months[0]}-01T00:00:00+05:30`), now = new Date();
        const [books, loans, outstanding, overdue] = await Promise.all([LibraryBook.countDocuments({ active: { $ne: false } }), LibraryLoan.find({ $or: [{ createdAt: { $gte: since } }, { returnedAt: { $gte: since } }] }, 'createdAt returnedAt').lean(), LibraryLoan.countDocuments({ returnedAt: null }), LibraryLoan.countDocuments({ returnedAt: null, dueDate: { $lt: now } })]);
        return { books, outstanding, overdue, monthly: months.map(month => ({ month, issued: loans.filter(l => monthKey(l.createdAt) === month).length, returned: loans.filter(l => l.returnedAt && monthKey(l.returnedAt) === month).length })) };
    },
};
insightsRouter.get('/', asyncRoute(async (req, res) => {
    const build = builders[req.auth.role];
    if (!build)
        return res.json({ role: req.auth.role, kind: 'none', generatedOn: dayKey(new Date()) });
    res.json({ role: req.auth.role, kind: req.auth.role, generatedOn: dayKey(new Date()), ...(await build(req)) });
}));
