import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { Membership, PlatformAdmin, School, Session, Subscription, Plan } from '../models.js';
import { runInScope } from '../tenant-scope.js';
import { isSubscriptionUsable } from '../billing.js';
const secret = () => process.env.JWT_SECRET || '';
export async function authenticate(req, res, next) {
    try {
        const header = req.headers.authorization || '';
        if (!header.startsWith('Bearer '))
            return res.status(401).json({ message: 'Sign in required' });
        if (!secret())
            return res.status(500).json({ message: 'Server authentication is not configured' });
        const claims = jwt.verify(header.slice(7), secret(), { algorithms: ['HS256'] });
        if (!claims.sub || !claims.sessionId || !['member', 'applicant', 'platform_admin'].includes(claims.tokenType))
            return res.status(401).json({ message: 'Invalid login token' });
        let scope;
        if (claims.tokenType === 'member') {
            if (!claims.schoolId || !claims.role)
                return res.status(401).json({ message: 'Invalid school membership token' });
            scope = { schoolId: claims.schoolId, userId: claims.sub, role: claims.role };
            const valid = await runInScope(scope, async () => {
                const [session, member, school] = await Promise.all([
                    Session.findOne({ _id: claims.sessionId, userId: claims.sub, schoolId: claims.schoolId, tokenType: 'member', revokedAt: null, expiresAt: { $gt: new Date() } }).lean(),
                    Membership.findOne({ userId: claims.sub, role: claims.role, status: 'active' }).lean(),
                    School.findOne({ _id: claims.schoolId, status: 'active' }).lean(),
                ]);
                return !!(session && member && school);
            });
            if (!valid)
                return res.status(401).json({ message: 'Membership or device session is no longer active' });
        }
        else if (claims.tokenType === 'platform_admin') {
            scope = { userId: claims.sub, system: true };
            const valid = await runInScope(scope, async () => {
                const [session, admin] = await Promise.all([
                    Session.findOne({ _id: claims.sessionId, userId: claims.sub, tokenType: 'platform_admin', revokedAt: null, expiresAt: { $gt: new Date() } }).lean(),
                    PlatformAdmin.findOne({ userId: claims.sub, status: 'active' }).lean(),
                ]);
                return !!(session && admin);
            });
            if (!valid)
                return res.status(401).json({ message: 'Platform admin session is no longer active' });
        }
        else {
            scope = { userId: claims.sub, system: true };
            const valid = await runInScope(scope, () => Session.findOne({ _id: claims.sessionId, userId: claims.sub, tokenType: 'applicant', revokedAt: null, expiresAt: { $gt: new Date() } }).lean());
            if (!valid)
                return res.status(401).json({ message: 'Applicant session is no longer active' });
        }
        req.auth = claims;
        runInScope(scope, () => next());
    }
    catch (error) {
        if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError)
            return res.status(401).json({ message: 'Your login is invalid or has expired. Please sign in again.' });
        next(error);
    }
}
const rolePermissions = {
    owner: ['*'],
    principal: ['students.view', 'students.create', 'students.update', 'students.import', 'students.export', 'admissions.create_direct', 'invites.create', 'classes.manage', 'classes.view', 'academic.manage', 'school.profile.manage', 'admissions.manage', 'attendance.mark', 'attendance.view', 'attendance.notify', 'homework.manage', 'homework.view', 'fees.manage', 'fees.view', 'payroll.prepare', 'payroll.view', 'staff.manage', 'staff.attendance.manage', 'staff.leave.manage', 'timetable.manage', 'timetable.view', 'exams.manage', 'exams.view', 'promotion.manage', 'messages.use', 'messages.moderate', 'library.manage', 'library.view', 'transport.manage', 'transport.view', 'audit.view'],
    admission_staff: ['students.view', 'students.create', 'admissions.manage', 'promotion.manage', 'invites.create'],
    accountant: ['students.view', 'fees.manage', 'fees.view', 'payroll.prepare', 'payroll.view', 'staff.leave.request'],
    teacher: ['students.view', 'classes.view', 'attendance.mark', 'attendance.view', 'attendance.notify', 'homework.manage', 'homework.view', 'timetable.view', 'exams.manage', 'exams.view', 'messages.use', 'staff.leave.request'],
    librarian: ['library.manage', 'library.view', 'staff.leave.request'],
    bus_driver: ['transport.view', 'transport.location.push', 'staff.leave.request'],
    parent: ['students.view', 'library.view', 'fees.view', 'messages.use', 'exams.view', 'timetable.view', 'transport.view', 'attendance.view', 'homework.view', 'support.create'],
    student: ['students.view', 'library.view', 'fees.view', 'exams.view', 'timetable.view', 'attendance.view', 'homework.view', 'support.create'],
};
export function requirePermission(permission) {
    return (req, res, next) => {
        const role = req.auth?.role;
        const allowed = rolePermissions[role || ''] || [];
        if (!allowed.includes('*') && !allowed.includes(permission))
            return res.status(403).json({ message: `Role cannot ${permission}` });
        next();
    };
}
export function requireRoles(...roles) {
    return (req, res, next) => roles.includes(req.auth?.role || '') ? next() : res.status(403).json({ message: 'This action is not allowed for your role' });
}
export function requirePlatformAdmin(req, res, next) {
    return req.auth?.tokenType === 'platform_admin' ? next() : res.status(403).json({ message: 'Platform administrator access required' });
}
export function requireTokenType(...types) {
    return (req, res, next) => types.includes(req.auth?.tokenType || 'member') ? next() : res.status(403).json({ message: 'This account type cannot use this route' });
}
export function requireFeature(feature) {
    return async (req, res, next) => {
        try {
            const scope = { schoolId: req.auth?.schoolId, userId: req.auth?.sub, role: req.auth?.role };
            if (!scope.schoolId)
                return res.status(403).json({ message: 'A school membership is required' });
            const sub = await runInScope(scope, () => Subscription.findOne({}).lean());
            if (!isSubscriptionUsable(sub))
                return res.status(403).json({ message: 'The school subscription is inactive' });
            const plan = await Plan.findOne({ key: sub.planKey, available: true }).lean();
            if (!plan?.features?.includes(feature))
                return res.status(403).json({ message: `Your plan does not include ${feature}` });
            next();
        }
        catch (error) {
            next(error);
        }
    };
}
/** Plan features of the signed-in school (empty list if the subscription is inactive). Call inside an authenticated request. */
export async function schoolFeatures() {
    const sub = await Subscription.findOne({}).lean();
    if (!isSubscriptionUsable(sub))
        return [];
    const plan = await Plan.findOne({ key: sub.planKey, available: true }).lean();
    return plan?.features || [];
}
export async function issueToken(userId, tokenType, options = {}) {
    const sessionId = new Types.ObjectId().toString();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const ip = options.req?.ip || '';
    const crypto = await import('node:crypto');
    const ipHash = ip && secret() ? crypto.createHmac('sha256', secret()).update(ip).digest('hex') : undefined;
    await Session.create({ _id: sessionId, userId, schoolId: options.schoolId ?? null, role: options.role,
        tokenType, device: String(options.req?.headers['x-device-name'] || '').slice(0, 100), ipHash,
        userAgent: String(options.req?.headers['user-agent'] || '').slice(0, 500), expiresAt });
    const claims = { sub: userId, sessionId, tokenType, ...(options.schoolId ? { schoolId: options.schoolId, role: options.role } : {}) };
    return jwt.sign(claims, secret(), { expiresIn: '8h', algorithm: 'HS256' });
}
export const permissionMap = rolePermissions;
