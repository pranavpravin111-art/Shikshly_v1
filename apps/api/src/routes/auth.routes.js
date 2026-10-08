import { Router } from 'express';
import { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApplicantProfile, Invite, Membership, PlatformAdmin, School, Session, Student, Subscription, User } from '../models.js';
import { runInScope } from '../tenant-scope.js';
import { asyncRoute, id } from '../helpers.js';
import { inTransaction } from '../db.js';
import { authenticate, issueToken } from '../middleware/auth.js';
import { consumeToken, findActiveUserByEmail, sendPasswordResetEmail, sendVerificationEmail } from '../auth-emails.js';
export const authRouter = Router();
const signup = z.object({ schoolName: z.string().trim().min(2).max(160), name: z.string().trim().min(2).max(160), email: z.string().email().max(320), password: z.string().min(10).max(128) });
const credentials = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(128), schoolId: z.string().optional(), context: z.enum(['member', 'applicant', 'platform_admin']).optional() });
const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hashCode = (v) => createHash('sha256').update(v.trim().toUpperCase()).digest('hex');
const secret = () => process.env.JWT_SECRET || '';
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-for-timing', 12);
authRouter.post('/register-school', asyncRoute(async (req, res) => {
    const body = signup.parse(req.body);
    if (!secret())
        return res.status(503).json({ message: 'JWT_SECRET is not configured' });
    const userId = new Types.ObjectId(), schoolId = new Types.ObjectId();
    const passwordHash = await bcrypt.hash(body.password, 12);
    const schoolSlug = `${slugify(body.schoolName)}-${schoolId.toString().slice(0, 5)}`;
    try {
        await inTransaction(async (session) => {
            await User.create([{ _id: userId, name: body.name, email: body.email.toLowerCase(), passwordHash }], { session });
            await School.create([{ _id: schoolId, name: body.schoolName, slug: schoolSlug, status: 'active' }], { session });
            await runInScope({ schoolId: schoolId.toString(), userId: userId.toString(), role: 'owner' }, async () => {
                await Membership.create([{ schoolId, userId, role: 'owner', status: 'active' }], { session });
                await Subscription.create([{ schoolId, planKey: 'free', status: 'active', periodEnd: null, billingPeriod: 'monthly' }], { session });
            });
        });
    }
    catch (e) {
        if (e?.code === 11000)
            return res.status(409).json({ message: 'Email is already registered' });
        throw e;
    }
    void sendVerificationEmail({ _id: userId, name: body.name, email: body.email.toLowerCase() });
    const token = await issueToken(userId.toString(), 'member', { schoolId: schoolId.toString(), role: 'owner', req });
    res.status(201).json({ token, tokenType: 'member', schoolId: schoolId.toString(), schoolSlug });
}));
authRouter.post('/login', asyncRoute(async (req, res) => {
    const body = credentials.parse(req.body);
    const user = await User.findOne({ email: body.email.toLowerCase(), status: 'active' }).lean();
    // Always run one bcrypt comparison so response time does not reveal whether the email exists.
    const passwordOk = await bcrypt.compare(body.password, user?.passwordHash || DUMMY_HASH);
    if (!user || !passwordOk)
        return res.status(401).json({ message: 'Email or password is incorrect' });
    if (body.context === 'platform_admin') {
        const admin = await PlatformAdmin.findOne({ userId: user._id, status: 'active' }).lean();
        if (!admin)
            return res.status(403).json({ message: 'No active platform administrator account for this email' });
        const token = await issueToken(String(user._id), 'platform_admin', { req });
        return res.json({ token, tokenType: 'platform_admin' });
    }
    const isApplicant = !!await ApplicantProfile.findOne({ userId: user._id }).lean();
    if (body.context === 'applicant') {
        if (!isApplicant)
            return res.status(403).json({ message: 'No applicant account for this email' });
        const token = await issueToken(String(user._id), 'applicant', { req });
        return res.json({ token, tokenType: 'applicant' });
    }
    const memberships = await runInScope({ system: true, userId: String(user._id) }, () => Membership.find({ userId: user._id, status: 'active' }).lean());
    const schools = await School.find({ _id: { $in: memberships.map(m => m.schoolId) }, status: 'active' }).lean();
    const choices = memberships.map(m => ({ schoolId: String(m.schoolId), role: m.role, name: schools.find(s => String(s._id) === String(m.schoolId))?.name })).filter(s => s.name);
    const chosen = body.schoolId ? choices.find(s => s.schoolId === body.schoolId) : choices.length === 1 ? choices[0] : null;
    if (body.schoolId && !chosen)
        return res.status(403).json({ message: 'You are not an active member of that school' });
    if (!chosen) {
        if (choices.length)
            return res.json({ chooseSchool: choices, applicantAvailable: isApplicant });
        if (isApplicant) {
            const token = await issueToken(String(user._id), 'applicant', { req });
            return res.json({ token, tokenType: 'applicant' });
        }
        return res.status(403).json({ message: 'No active school membership or applicant account' });
    }
    const token = await issueToken(String(user._id), 'member', { schoolId: chosen.schoolId, role: chosen.role, req });
    res.json({ token, tokenType: 'member', schoolId: chosen.schoolId, role: chosen.role, applicantAvailable: isApplicant });
}));
authRouter.post('/join', asyncRoute(async (req, res) => {
    const body = z.object({ code: z.string().min(8).max(80), name: z.string().trim().min(2).max(160), email: z.string().email().max(320), password: z.string().min(10).max(128) }).parse(req.body);
    const invite = await runInScope({ system: true }, () => Invite.findOne({ codeHash: hashCode(body.code), status: 'active', expiresAt: { $gt: new Date() } }).lean());
    if (!invite || invite.usedCount >= invite.maxUses)
        return res.status(400).json({ message: 'Invite is invalid, expired or already used' });
    let user = await User.findOne({ email: body.email.toLowerCase() });
    if (user) {
        if (!await bcrypt.compare(body.password, user.passwordHash))
            return res.status(409).json({ message: 'This email already has an account; use its existing password' });
    }
    else {
        user = await User.create({ name: body.name, email: body.email.toLowerCase(), passwordHash: await bcrypt.hash(body.password, 12) });
        void sendVerificationEmail(user);
    }
    const schoolId = String(invite.schoolId), userId = String(user._id), role = invite.role;
    {
        await inTransaction(async (session) => runInScope({ schoolId, userId, role }, async () => {
            const used = await Invite.findOneAndUpdate({ _id: invite._id, status: 'active', usedCount: { $lt: invite.maxUses }, expiresAt: { $gt: new Date() } }, { $inc: { usedCount: 1 } }, { new: true, session });
            if (!used)
                throw Object.assign(new Error('Invite is invalid, expired or already used'), { statusCode: 400 });
            const existing = await Membership.findOne({ userId }).session(session ?? null);
            if (existing && !(existing.role === 'parent' && role === 'parent' && invite.linkedStudentId))
                throw Object.assign(new Error('Already a member of this school'), { statusCode: 409 });
            if (!existing)
                await Membership.create([{ schoolId: id(schoolId), userId: id(userId), role, status: 'active' }], { session });
            if (invite.linkedStudentId && role === 'parent')
                await Student.updateOne({ _id: invite.linkedStudentId }, { $addToSet: { guardianIds: id(userId) } }, { session });
            if (invite.linkedStudentId && role === 'student') {
                const updated = await Student.updateOne({ _id: invite.linkedStudentId, userId: null }, { $set: { userId: id(userId) } }, { session });
                if (updated.modifiedCount !== 1)
                    throw Object.assign(new Error('This student already has a login'), { statusCode: 409 });
            }
        }));
    }
    const token = await issueToken(userId, 'member', { schoolId, role, req });
    res.status(201).json({ token, tokenType: 'member', schoolId, role });
}));
authRouter.post('/applicant/register', asyncRoute(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(160), email: z.string().email().max(320), password: z.string().min(10).max(128), phone: z.string().max(32).optional() }).parse(req.body);
    let user = await User.findOne({ email: body.email.toLowerCase() });
    if (user)
        return res.status(409).json({ message: 'Email already registered; use login' });
    user = await User.create({ name: body.name, email: body.email.toLowerCase(), passwordHash: await bcrypt.hash(body.password, 12) });
    await ApplicantProfile.create({ userId: user._id, phone: body.phone || '' });
    void sendVerificationEmail(user);
    const token = await issueToken(String(user._id), 'applicant', { req });
    res.status(201).json({ token, tokenType: 'applicant' });
}));
authRouter.post('/platform/bootstrap', asyncRoute(async (req, res) => {
    const expected = process.env.PLATFORM_ADMIN_BOOTSTRAP_SECRET || '';
    const body = z.object({ bootstrapSecret: z.string().min(1), name: z.string().trim().min(2).max(160), email: z.string().email(), password: z.string().min(12).max(128) }).parse(req.body);
    const a = Buffer.from(body.bootstrapSecret), b = Buffer.from(expected);
    if (expected.length < 32 || a.length !== b.length || !timingSafeEqual(a, b))
        return res.status(401).json({ message: 'Bootstrap is not configured or secret is invalid' });
    try {
        const user = await User.create({ name: body.name, email: body.email.toLowerCase(), passwordHash: await bcrypt.hash(body.password, 12) });
        const admin = await PlatformAdmin.create({ userId: user._id, status: 'active' });
        const token = await issueToken(String(user._id), 'platform_admin', { req });
        return res.status(201).json({ token, tokenType: 'platform_admin' });
    }
    catch (error) {
        if (error?.code === 11000)
            return res.status(409).json({ message: 'Platform admin already bootstrapped or email is already registered' });
        throw error;
    }
}));
authRouter.get('/me', authenticate, asyncRoute(async (req, res) => {
    if (req.auth?.tokenType === 'member') {
        const user = await User.findById(req.auth.sub).select('name email phone emailVerifiedAt').lean();
        const sub = await Subscription.findOne({}).lean();
        return res.json({ user, emailVerified: !!user?.emailVerifiedAt, schoolId: req.auth.schoolId, role: req.auth.role, plan: sub?.planKey });
    }
    res.json({ userId: req.auth?.sub, tokenType: req.auth?.tokenType });
}));
authRouter.get('/sessions', authenticate, asyncRoute(async (req, res) => {
    res.json(await Session.find({ userId: req.auth?.sub, revokedAt: null }).select('-ipHash').sort({ createdAt: -1 }).limit(100).lean());
}));
authRouter.post('/change-password', authenticate, asyncRoute(async (req, res) => {
    const body = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(10).max(128) }).strict().parse(req.body);
    if (body.currentPassword === body.newPassword) return res.status(400).json({ message: 'New password must be different from the current password' });
    const user = await User.findById(req.auth.sub).select('passwordHash');
    if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) return res.status(401).json({ message: 'Current password is incorrect' });
    user.passwordHash = await bcrypt.hash(body.newPassword, 12);
    await user.save();
    await Session.updateMany({ userId: req.auth.sub, _id: { $ne: req.auth.sessionId }, revokedAt: null }, { $set: { revokedAt: new Date() } });
    res.json({ changed: true, signedOutOtherSessions: true });
}));
authRouter.delete('/sessions/:sessionId', authenticate, asyncRoute(async (req, res) => {
    if (!Types.ObjectId.isValid(String(req.params.sessionId)))
        return res.status(400).json({ message: 'Invalid session id' });
    const session = await Session.findOneAndUpdate({ _id: req.params.sessionId, userId: req.auth?.sub, revokedAt: null }, { $set: { revokedAt: new Date() } }, { new: true });
    if (!session)
        return res.status(404).json({ message: 'Session not found' });
    res.json({ revoked: true });
}));
authRouter.post('/logout', authenticate, asyncRoute(async (req, res) => {
    await Session.updateOne({ _id: req.auth?.sessionId, userId: req.auth?.sub }, { $set: { revokedAt: new Date() } });
    res.json({ loggedOut: true });
}));

// ---- password reset and email verification ------------------------------------------------------
// forgot-password always answers the same way, so nobody can use it to find out which emails have accounts.
authRouter.post('/forgot-password', asyncRoute(async (req, res) => {
    const body = z.object({ email: z.string().email().max(320) }).parse(req.body);
    res.json({ message: 'If that email has an account, a reset link has been sent.' });
    const user = await findActiveUserByEmail(body.email);
    if (user)
        await sendPasswordResetEmail(user);
}));
authRouter.post('/reset-password', asyncRoute(async (req, res) => {
    const body = z.object({ token: z.string().min(20).max(200), password: z.string().min(10).max(128) }).parse(req.body);
    const userId = await consumeToken(body.token, 'password_reset');
    if (!userId)
        return res.status(400).json({ message: 'This reset link is invalid, expired or already used. Please ask for a new one.' });
    await User.updateOne({ _id: userId }, { $set: { passwordHash: await bcrypt.hash(body.password, 12) } });
    // Receiving the reset email also proves the person owns this address.
    await User.updateOne({ _id: userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
    // Anyone who had the old password (or a stolen session) is signed out everywhere.
    await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    res.json({ message: 'Password changed. Please sign in with your new password.' });
}));
authRouter.post('/verify-email', asyncRoute(async (req, res) => {
    const body = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
    const userId = await consumeToken(body.token, 'email_verify');
    if (!userId)
        return res.status(400).json({ message: 'This confirmation link is invalid, expired or already used.' });
    await User.updateOne({ _id: userId }, { $set: { emailVerifiedAt: new Date() } });
    res.json({ message: 'Email confirmed. Thank you!' });
}));
authRouter.post('/resend-verification', authenticate, asyncRoute(async (req, res) => {
    const user = await User.findById(req.auth?.sub);
    if (user && !user.emailVerifiedAt)
        await sendVerificationEmail(user);
    res.json({ message: user?.emailVerifiedAt ? 'Your email is already confirmed.' : 'Confirmation email sent.' });
}));
