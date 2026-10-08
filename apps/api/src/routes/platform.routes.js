import { Router } from 'express';
import { z } from 'zod';
import { AdmissionInquiry, Membership, Plan, PlatformAuditLog, School, SchoolSupportTicket, Student, Subscription, User } from '../models.js';
import { asyncRoute, paginatedLimit, platformAudit, validId } from '../helpers.js';
import { authenticate, requirePlatformAdmin } from '../middleware/auth.js';
import { runInScope } from '../tenant-scope.js';
export const platformRouter = Router();
/** Parses ?from / ?to (YYYY-MM-DD, inclusive) into a Mongo date range. */
export function dateRange(from, to) {
    const ok = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
    if (from === undefined && to === undefined)
        return null;
    if ((from !== undefined && !ok(from)) || (to !== undefined && !ok(to)))
        return 'invalid';
    return { ...(from ? { $gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { $lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) } : {}) };
}
platformRouter.use(authenticate, requirePlatformAdmin);
platformRouter.get('/overview', asyncRoute(async (_req, res) => {
    const [schools, activeSchools, plans, tickets] = await Promise.all([School.countDocuments({}), School.countDocuments({ status: 'active' }), Plan.countDocuments({ available: true }), runInScope({ system: true }, () => SchoolSupportTicket.countDocuments({ status: { $in: ['open', 'in_progress'] } }))]);
    res.json({ schools, activeSchools, availablePlans: plans, openTickets: tickets });
}));
platformRouter.get('/schools', asyncRoute(async (req, res) => {
    const rows = await School.find({}).sort({ createdAt: -1 }).limit(Math.min(500, Math.max(1, Number(req.query.limit) || 100))).lean();
    const ids = rows.map(s => s._id);
    const [subs, counts] = await Promise.all([runInScope({ system: true }, () => Subscription.find({ schoolId: { $in: ids } }).lean()), Promise.all(rows.map(async (s) => ({ schoolId: String(s._id), students: await runInScope({ schoolId: String(s._id) }, () => Student.countDocuments({ status: 'active' })), members: await runInScope({ schoolId: String(s._id) }, () => Membership.countDocuments({ status: 'active' })) })))]);
    res.json(rows.map(s => ({ ...s, subscription: subs.find(x => String(x.schoolId) === String(s._id)) || null, usage: counts.find(x => x.schoolId === String(s._id)) })));
}));
platformRouter.patch('/schools/:schoolId/status', asyncRoute(async (req, res) => {
    if (!validId(req.params.schoolId))
        return res.status(400).json({ message: 'Invalid school id' });
    const body = z.object({ status: z.enum(['active', 'suspended', 'closed']) }).parse(req.body);
    const school = await School.findByIdAndUpdate(req.params.schoolId, { $set: { status: body.status } }, { new: true }).lean();
    if (!school)
        return res.status(404).json({ message: 'School not found' });
    await platformAudit(req, 'platform.school_status_changed', req.params.schoolId, { status: body.status });
    res.json(school);
}));
platformRouter.get('/plans', asyncRoute(async (_req, res) => res.json(await Plan.find({}).sort({ monthlyPaise: 1 }).lean())));
platformRouter.patch('/plans/:key', asyncRoute(async (req, res) => {
    if (!['free', 'basic', 'standard', 'premium'].includes(req.params.key))
        return res.status(400).json({ message: 'Invalid plan key' });
    const body = z.object({ monthlyPaise: z.number().int().nonnegative().nullable().optional(), annualPaise: z.number().int().nonnegative().nullable().optional(), pricePerStudentPaise: z.number().int().nonnegative().nullable().optional(), minimumMonthlyPaise: z.number().int().nonnegative().nullable().optional(), trialDays: z.number().int().min(0).max(365).optional(), available: z.boolean().optional(), limits: z.record(z.union([z.number().nonnegative(), z.string().max(120), z.boolean(), z.null()])).optional() }).strict().parse(req.body);
    const plan = await Plan.findOneAndUpdate({ key: req.params.key }, { $set: body }, { new: true }).lean();
    if (!plan)
        return res.status(404).json({ message: 'Plan not found' });
    await platformAudit(req, 'platform.plan_edited', null, { plan: req.params.key, fields: Object.keys(body) });
    res.json(plan);
}));
platformRouter.put('/schools/:schoolId/subscription', asyncRoute(async (req, res) => {
    if (!validId(req.params.schoolId))
        return res.status(400).json({ message: 'Invalid school id' });
    const body = z.object({ planKey: z.enum(['free', 'basic', 'standard', 'premium']), status: z.enum(['active', 'trial', 'past_due', 'cancelled']), periodEnd: z.string().datetime().nullable().optional() }).parse(req.body);
    if (!await School.exists({ _id: req.params.schoolId }))
        return res.status(404).json({ message: 'School not found' });
    const sub = await runInScope({ schoolId: req.params.schoolId }, () => Subscription.findOneAndUpdate({}, { $set: { planKey: body.planKey, status: body.status, periodEnd: body.periodEnd ? new Date(body.periodEnd) : null } }, { new: true, upsert: true, setDefaultsOnInsert: true }));
    await platformAudit(req, 'platform.subscription_changed', req.params.schoolId, { planKey: body.planKey, status: body.status, periodEnd: body.periodEnd || null });
    res.json(sub);
}));
// Super-admin history: who changed what on the platform. Filter with ?schoolId= &action= &from=YYYY-MM-DD &to=YYYY-MM-DD
platformRouter.get('/history', asyncRoute(async (req, res) => {
    const filter = {};
    if (typeof req.query.schoolId === 'string') {
        if (!validId(req.query.schoolId))
            return res.status(400).json({ message: 'Invalid school id' });
        filter.targetSchoolId = req.query.schoolId;
    }
    if (typeof req.query.action === 'string')
        filter.action = req.query.action.slice(0, 80);
    const range = dateRange(req.query.from, req.query.to);
    if (range === 'invalid')
        return res.status(400).json({ message: 'from/to must be YYYY-MM-DD' });
    if (range)
        filter.createdAt = range;
    const rows = await PlatformAuditLog.find(filter).sort({ createdAt: -1 }).limit(paginatedLimit(req.query.limit, 500)).lean();
    const [actors, schools] = await Promise.all([
        User.find({ _id: { $in: rows.map((r) => r.actorId) } }).select('name email').lean(),
        School.find({ _id: { $in: rows.map((r) => r.targetSchoolId).filter(Boolean) } }).select('name').lean()
    ]);
    res.json(rows.map((r) => ({ id: r._id, at: r.createdAt, action: r.action, meta: r.meta,
        actor: actors.find((u) => String(u._id) === String(r.actorId))?.name || 'Unknown',
        school: schools.find((s) => String(s._id) === String(r.targetSchoolId))?.name || null, schoolId: r.targetSchoolId })));
}));
platformRouter.get('/support', asyncRoute(async (_req, res) => res.json(await runInScope({ system: true }, () => SchoolSupportTicket.find({}).sort({ createdAt: -1 }).limit(200).lean()))));
platformRouter.get('/admission-volume', asyncRoute(async (_req, res) => {
    const rows = await runInScope({ system: true }, () => AdmissionInquiry.aggregate([{ $group: { _id: '$schoolId', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 100 }]));
    res.json(rows);
}));
