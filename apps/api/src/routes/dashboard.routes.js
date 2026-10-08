import { Router } from 'express';
import { AcademicYear, AdmissionApplication, AdmissionInquiry, Attendance, AuditLog, Classroom, FeeCharge, FeePayment, Homework, LibraryBook, LibraryLoan, Membership, PayrollRun, School, SchoolProfile, SmsUsage, Student, Subscription, TransportVehicle } from '../models.js';
import { asyncRoute, validId } from '../helpers.js';
import { authenticate, requireRoles } from '../middleware/auth.js';
export const dashboardRouter = Router();
/** Sum of one numeric field over every row of the signed-in school (a missing field counts as 0). */
async function sumOf(model, field) { const [row] = await model.aggregate([{ $group: { _id: null, total: { $sum: `$${field}` } } }]); return row?.total || 0; }
/** One aggregate per field (instead of one multi-field $group) so results are identical on every MongoDB-compatible server. */
async function feeSums() {
    const [amount, fine, discount, paid] = await Promise.all(['amountPaise', 'finePaise', 'discountPaise', 'paidPaise'].map(f => sumOf(FeeCharge, f)));
    return { amount, fine, discount, paid };
}
/**
 * Sum of a numeric field for each of the last 12 months, as {'2026-10': total}.
 * One small indexed aggregate per month (12 total) is cheap and works on every MongoDB-compatible server.
 */
async function monthlyTotals(model, dateField, match, sumField, first) {
    const totals = {};
    await Promise.all(Array.from({ length: 12 }, async (_, i) => {
        const from = new Date(first);
        from.setUTCMonth(first.getUTCMonth() + i);
        const to = new Date(first);
        to.setUTCMonth(first.getUTCMonth() + i + 1);
        const [row] = await model.aggregate([{ $match: { ...match, [dateField]: { $gte: from, $lt: to } } }, { $group: { _id: null, total: { $sum: sumField } } }]);
        totals[from.toISOString().slice(0, 7)] = row?.total || 0;
    }));
    return totals;
}
dashboardRouter.use(authenticate, requireRoles('owner', 'principal'));
dashboardRouter.get('/overview', asyncRoute(async (req, res) => {
    const schoolId = req.auth.schoolId;
    const school = await School.findById(schoolId).select('name slug status createdAt').lean();
    const profile = await SchoolProfile.findOne({}).lean();
    const subscription = await Subscription.findOne({}).lean();
    const yearId = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
    if (yearId && !validId(yearId))
        return res.status(400).json({ message: 'Invalid academic year id' });
    const year = yearId ? await AcademicYear.findById(yearId).lean() : await AcademicYear.findOne({ isCurrent: true }).lean();
    if (yearId && !year)
        return res.status(404).json({ message: 'Academic year not found' });
    const studentFilter = { status: 'active' };
    if (year?._id)
        studentFilter.academicYearId = year._id;
    const classFilter = {};
    if (year?._id)
        classFilter.academicYearId = year._id;
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 29);
    const from = start.toISOString().slice(0, 10);
    const currentMonth = new Date();
    currentMonth.setUTCDate(1);
    currentMonth.setUTCHours(0, 0, 0, 0);
    const lookback = new Date();
    lookback.setUTCMonth(lookback.getUTCMonth() - 11, 1);
    lookback.setUTCHours(0, 0, 0, 0);
    const [students, classes, teachers, parents, staff, attendance, applications, inquiries, charges, payments, smsUsage, homework, books, openLoans, payroll, vehicles, activity] = await Promise.all([
        Student.countDocuments(studentFilter), Classroom.countDocuments(classFilter), Membership.countDocuments({ role: 'teacher', status: 'active' }), Membership.countDocuments({ role: 'parent', status: 'active' }), Membership.countDocuments({ status: 'active' }),
        Attendance.aggregate([{ $match: { date: { $gte: from } } }, { $group: { _id: { date: '$date', status: '$status' }, count: { $sum: 1 } } }, { $sort: { '_id.date': 1 } }]),
        // Totals are calculated inside MongoDB, so the dashboard stays fast however many fee rows a school has.
        AdmissionApplication.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]), AdmissionInquiry.countDocuments({ status: { $in: ['new', 'contacted'] } }),
        feeSums(),
        monthlyTotals(FeePayment, 'paidAt', { status: 'paid' }, '$amountPaise', lookback),
        monthlyTotals(SmsUsage, 'createdAt', { status: 'sent' }, '$units', lookback),
        Homework.countDocuments({ status: 'assigned' }), LibraryBook.countDocuments({ active: true }), LibraryLoan.countDocuments({ returnedAt: null }), PayrollRun.find({}).select('status month items.netPaise').sort({ month: -1 }).limit(12).lean(), TransportVehicle.countDocuments({ active: true }), AuditLog.find({}).select('actorId role action entity entityId createdAt').sort({ createdAt: -1 }).limit(8).lean(),
    ]);
    const attendanceByDay = new Map();
    for (const row of attendance) {
        const key = String(row._id.date);
        const counts = attendanceByDay.get(key) || { present: 0, absent: 0, late: 0, excused: 0 };
        counts[row._id.status] = row.count;
        attendanceByDay.set(key, counts);
    }
    const timezone = profile?.timeZone || 'Asia/Kolkata';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    const attendanceDays = Array.from({ length: 30 }, (_, i) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (29 - i)); const date = d.toISOString().slice(0, 10); const c = attendanceByDay.get(date) || { present: 0, absent: 0, late: 0, excused: 0 }; const marked = c.present + c.absent + c.late + c.excused; return { date, ...c, marked, attendanceRate: marked ? Math.round((c.present + c.late) / marked * 100) : null }; });
    const byStatus = {};
    for (const a of applications)
        byStatus[String(a._id)] = a.count;
    // Outstanding = amount + fine - discount - already paid (never below zero), the same rule the payment routes use.
    const fee = charges;
    const paidTotal = fee.paid || 0;
    const dueTotal = Math.max(0, (fee.amount || 0) + (fee.fine || 0) - (fee.discount || 0) - (fee.paid || 0));
    const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(lookback); d.setUTCMonth(lookback.getUTCMonth() + i); return { key: d.toISOString().slice(0, 7), label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }), amountPaise: 0 }; });
    const monthMap = new Map(months.map(m => [m.key, m]));
    for (const m of months)
        m.amountPaise = payments[m.key] || 0;
    const smsMonths = months.map(m => ({ ...m, units: 0 }));
    const smsMap = new Map(smsMonths.map(m => [m.key, m]));
    for (const m of smsMonths)
        m.units = smsUsage[m.key] || 0;
    const smsSentThisMonth = smsMap.get(currentMonth.toISOString().slice(0, 7))?.units || 0;
    res.json({ school, profile, academicYear: year ? { id: year._id, name: year.name, startDate: year.startDate, endDate: year.endDate } : null, subscription,
        cards: { activeStudents: students, classes, teachers, parents, activeMembers: staff, openAdmissionInquiries: inquiries, pendingApplications: (byStatus.submitted || 0) + (byStatus.under_review || 0), homeworkAssigned: homework, libraryBooks: books, openLibraryLoans: openLoans, activeVehicles: vehicles, feesCollectedPaise: paidTotal, feesOutstandingPaise: dueTotal, smsSentThisMonth },
        graphs: { attendance30Days: attendanceDays, admissionsByStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })), feeCollections12Months: months.map(m => ({ ...m })), smsUsage12Months: smsMonths.map(m => ({ month: m.key, label: m.label, units: m.units })), recentPayroll: payroll.map(p => ({ month: p.month, status: p.status, netPaise: p.items.reduce((s, x) => s + (x.netPaise || 0), 0) })) },
        recentActivity: activity.map(a => ({ action: a.action, entity: a.entity, entityId: a.entityId, role: a.role, createdAt: a.createdAt })) });
}));
