import { Router } from 'express';
import { z } from 'zod';
import { Attendance, Membership, Plan, Student, Subscription, SmsUsage, User } from '../models.js';
import { asyncRoute, audit, id, validId } from '../helpers.js';
import { authenticate, requireFeature, requirePermission, requireRoles } from '../middleware/auth.js';
export const smsRouter = Router();
smsRouter.use(authenticate);
smsRouter.put('/me/consent', asyncRoute(async (req, res) => {
    if (!req.auth?.schoolId || req.auth.tokenType !== 'member')
        return res.status(403).json({ message: 'School membership required' });
    const body = z.object({ enabled: z.boolean() }).parse(req.body);
    const membership = await Membership.findOneAndUpdate({ userId: id(req.auth.sub), role: req.auth.role, status: 'active' }, { $set: { smsConsent: body.enabled } }, { new: true });
    if (!membership)
        return res.status(404).json({ message: 'Membership not found' });
    res.json({ smsConsent: membership.smsConsent });
}));
smsRouter.get('/usage', requireRoles('owner', 'principal'), requireFeature('sms'), asyncRoute(async (_req, res) => {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const [sub, used, plan] = await Promise.all([Subscription.findOne({}).lean(), SmsUsage.countDocuments({ createdAt: { $gte: start }, status: { $in: ['queued', 'sent'] } }), Promise.resolve(null)]);
    const selectedPlan = sub ? await Plan.findOne({ key: sub.planKey }).lean() : plan;
    const allowance = Number(selectedPlan?.limits?.smsMonthly || 0);
    res.json({ periodStart: start, used, allowance, remaining: Math.max(0, allowance - used), status: allowance === 0 ? 'not_configured' : used >= allowance ? 'limit_reached' : 'available' });
}));
smsRouter.post('/attendance/:classId/:date', requireRoles('owner', 'principal', 'teacher'), requireFeature('sms'), requireFeature('attendance'), requirePermission('attendance.notify'), asyncRoute(async (req, res) => {
    const { classId, date } = req.params;
    if (!validId(classId) || !/^(\d{4})-(\d{2})-(\d{2})$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
        return res.status(400).json({ message: 'Class or date is invalid' });
    const templateId = process.env.MSG91_ATTENDANCE_TEMPLATE_ID, authKey = process.env.MSG91_AUTH_KEY;
    if (!templateId || !authKey)
        return res.status(503).json({ message: 'SMS provider and approved attendance template are not configured' });
    const sub = await Subscription.findOne({}).lean();
    const plan = sub ? await Plan.findOne({ key: sub.planKey }).lean() : null;
    const allowance = Number(plan?.limits?.smsMonthly || 0);
    const periodStart = new Date();
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);
    const alreadyUsed = await SmsUsage.countDocuments({ createdAt: { $gte: periodStart }, status: { $in: ['queued', 'sent'] } });
    const remaining = Math.max(0, allowance - alreadyUsed);
    if (!remaining)
        return res.status(403).json({ message: 'This plan has no SMS allowance configured or its allowance is exhausted', used: alreadyUsed, allowance });
    const absences = await Attendance.find({ classId: id(classId), date, status: 'absent' }).select('studentId').limit(300).lean();
    const students = await Student.find({ _id: { $in: absences.map(a => a.studentId) } }).select('name guardianIds').lean();
    const parentIds = [...new Set(students.flatMap(s => s.guardianIds.map(String)))].map(id);
    const memberships = await Membership.find({ userId: { $in: parentIds }, role: 'parent', status: 'active', smsConsent: true }).select('userId').lean();
    const eligible = new Set(memberships.map(m => String(m.userId)));
    const parents = await User.find({ _id: { $in: [...eligible].map(id) } }).select('name phone').lean();
    const users = new Map(parents.map(p => [String(p._id), p]));
    const recipients = students.flatMap(student => student.guardianIds.filter((g) => eligible.has(String(g))).map((g) => ({ student, user: users.get(String(g)) }))).filter(x => !!x.user?.phone).slice(0, Math.min(100, remaining));
    if (!recipients.length)
        return res.json({ sent: 0, skippedForConsent: parentIds.filter(p => !eligible.has(String(p))).length, reason: 'No parent with a phone number and active SMS consent' });
    let sent = 0, failed = 0;
    for (const recipient of recipients) {
        const user = recipient.user;
        const digits = user.phone.replace(/\D/g, '');
        const mobile = digits.length === 10 ? `91${digits}` : digits.length >= 11 ? digits : '';
        if (!mobile) {
            failed++;
            await SmsUsage.create({ recipientUserId: user._id, maskedPhone: 'invalid', category: 'attendance_absent', templateId, provider: 'msg91', status: 'failed', errorCode: 'invalid_phone' });
            continue;
        }
        let status = 'failed', providerMessageId = '', errorCode = 'provider_error';
        try {
            const response = await fetch(process.env.MSG91_FLOW_URL || 'https://control.msg91.com/api/v5/flow', { method: 'POST', headers: { accept: 'application/json', authkey: authKey, 'content-type': 'application/json' }, body: JSON.stringify({ template_id: templateId, realTimeResponse: '1', recipients: [{ mobiles: mobile, VAR1: recipient.student.name.slice(0, 40), VAR2: date }] }), signal: AbortSignal.timeout(8000) });
            const payload = await response.json().catch(() => ({}));
            if (response.ok && String(payload.type || '').toLowerCase() !== 'error') {
                status = 'sent';
                sent++;
                providerMessageId = String(payload.request_id || payload.requestId || payload.message || '');
            }
            else {
                failed++;
                errorCode = String(payload.message || payload.error || `http_${response.status}`).slice(0, 120);
            }
        }
        catch (error) {
            failed++;
            errorCode = error instanceof Error ? error.name : 'network_error';
        }
        const masked = `${mobile.slice(0, 4)}••••${mobile.slice(-2)}`;
        await SmsUsage.create({ recipientUserId: user._id, maskedPhone: masked, category: 'attendance_absent', templateId, provider: 'msg91', providerMessageId, status, errorCode: status === 'failed' ? errorCode : undefined, units: 1, sentAt: status === 'sent' ? new Date() : undefined });
    }
    await audit(req, 'sms.attendance_dispatched', 'classroom', classId, { date, sent, failed });
    res.json({ sent, failed, eligibleRecipients: recipients.length, provider: 'msg91', delivery: 'provider_acceptance_not_delivery_confirmation' });
}));
