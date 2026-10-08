import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AdmissionApplication, AdmissionInquiry, ApplicantProfile, AppReview, Plan, PublicSchool, Review, School, Student, Subscription, User } from '../models.js';
import { runInScope } from '../tenant-scope.js';
import { asyncRoute } from '../helpers.js';
import { issueToken, authenticate, requireRoles, requireTokenType } from '../middleware/auth.js';
import { isSubscriptionUsable } from '../billing.js';
import { emailVerificationRequired, sendVerificationEmail } from '../auth-emails.js';
export const publicRouter = Router();
export const applicantRouter = Router();
const inquiryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: true, legacyHeaders: false, message: { message: 'Too many inquiry attempts. Please try later.' } });
const inquiryBody = z.object({ name: z.string().trim().min(2).max(160), email: z.string().email().max(320), password: z.string().min(10).max(128), phone: z.string().max(32).optional(), message: z.string().trim().min(10).max(3000) });
async function hasSchoolFeature(schoolId, feature) {
    const sub = await runInScope({ system: true }, () => Subscription.findOne({ schoolId }).lean());
    if (!isSubscriptionUsable(sub))
        return false;
    const plan = await Plan.findOne({ key: sub.planKey, available: true }).lean();
    return !!plan?.features?.includes(feature);
}
function distanceKm(lat1, lon1, lat2, lon2) {
    const toRad = (v) => v * Math.PI / 180, dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
publicRouter.get('/app-rating', asyncRoute(async (_req, res) => {
    const [stats, mine] = await Promise.all([AppReview.aggregate([{ $match: { moderationStatus: 'published' } }, { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }]), Promise.resolve(null)]);
    res.json({ average: Number((stats[0]?.average || 0).toFixed(1)), count: stats[0]?.count || 0 });
}));
publicRouter.get('/app-rating/summary', asyncRoute(async (_req, res) => {
    const rows = await AppReview.aggregate([{ $match: { moderationStatus: 'published' } }, { $group: { _id: '$rating', count: { $sum: 1 } } }]);
    const distribution = Object.fromEntries([1,2,3,4,5].map(n => [n, rows.find(r => r._id === n)?.count || 0]));
    const total = Object.values(distribution).reduce((a,b)=>a+b,0); const average = total ? Object.entries(distribution).reduce((a,[r,c])=>a + Number(r)*c,0)/total : 0;
    res.json({ average: Number(average.toFixed(1)), count: total, distribution });
}));
publicRouter.get('/plans', asyncRoute(async (_req, res) => {
    res.json(await Plan.find({ available: true }).select('-__v').sort({ key: 1 }).lean());
}));
publicRouter.get('/schools', asyncRoute(async (req, res) => {
    const name = String(req.query.name || '').trim().slice(0, 100), area = String(req.query.area || '').trim().slice(0, 100), city = String(req.query.city || '').trim().slice(0, 100);
    const filter = { isPublic: true };
    if (name)
        filter.name = { $regex: name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (area)
        filter.area = { $regex: area.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    if (city)
        filter.city = { $regex: city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const rows = await PublicSchool.find(filter).select('slug name area city state country latitude longitude description photos facilities rating reviewCount').limit(300).lean();
    const lat = Number(req.query.lat), lon = Number(req.query.lon), radius = Number(req.query.radiusKm);
    if (req.query.lat !== undefined || req.query.lon !== undefined) {
        if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180)
            return res.status(400).json({ message: 'lat/lon must be valid coordinates' });
    }
    const items = rows.filter((school) => {
        if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(radius) && radius > 0) {
            if (typeof school.latitude !== 'number' || typeof school.longitude !== 'number')
                return false;
            school.distanceKm = Number(distanceKm(lat, lon, school.latitude, school.longitude).toFixed(1));
            return school.distanceKm <= Math.min(radius, 500);
        }
        return true;
    }).sort((a, b) => a.distanceKm !== undefined && b.distanceKm !== undefined ? a.distanceKm - b.distanceKm : a.name.localeCompare(b.name));
    res.json({ items, count: items.length });
}));
publicRouter.get('/schools/:slug', asyncRoute(async (req, res) => {
    const school = await PublicSchool.findOne({ slug: req.params.slug, isPublic: true }).lean();
    if (!school || !await School.exists({ _id: school.schoolId, status: 'active' }))
        return res.status(404).json({ message: 'School not found' });
    const [inquiries, admissions, reviews] = await Promise.all([
        hasSchoolFeature(String(school.schoolId), 'admissions_inquiries'), hasSchoolFeature(String(school.schoolId), 'admissions'),
        Review.find({ schoolId: school.schoolId, moderationStatus: 'approved' }).select('rating title body createdAt reviewerId').sort({ createdAt: -1 }).limit(20).lean(),
    ]);
    res.json({ ...school, admissionInquiriesEnabled: inquiries, admissionsEnabled: admissions, reviews });
}));
publicRouter.post('/schools/:slug/inquiries', inquiryLimiter, asyncRoute(async (req, res) => {
    const body = inquiryBody.parse(req.body);
    const publicSchool = await PublicSchool.findOne({ slug: req.params.slug, isPublic: true }).lean();
    if (!publicSchool || !await School.exists({ _id: publicSchool.schoolId, status: 'active' }))
        return res.status(404).json({ message: 'School not found' });
    if (!await hasSchoolFeature(String(publicSchool.schoolId), 'admissions_inquiries'))
        return res.status(403).json({ message: 'This school is not accepting inquiries' });
    let user = await User.findOne({ email: body.email.toLowerCase() });
    if (user) {
        if (!await bcrypt.compare(body.password, user.passwordHash))
            return res.status(409).json({ message: 'This email already has an account; sign in with its password' });
    }
    else {
        user = await User.create({ name: body.name, email: body.email.toLowerCase(), phone: body.phone || '', passwordHash: await bcrypt.hash(body.password, 12) });
        void sendVerificationEmail(user);
    }
    await ApplicantProfile.updateOne({ userId: user._id }, { $setOnInsert: { userId: user._id, phone: body.phone || '' } }, { upsert: true });
    const inquiry = await runInScope({ schoolId: String(publicSchool.schoolId), userId: String(user._id) }, () => AdmissionInquiry.create({
        applicantUserId: user._id, name: body.name, email: body.email.toLowerCase(), phone: body.phone || '', message: body.message, status: 'new',
    }));
    const token = await issueToken(String(user._id), 'applicant', { req });
    res.status(201).json({ token, tokenType: 'applicant', inquiry: { id: inquiry._id, schoolId: publicSchool.schoolId, status: inquiry.status, createdAt: inquiry.createdAt } });
}));
publicRouter.post('/schools/:slug/reviews', authenticate, requireTokenType('member'), requireRoles('parent', 'student'), asyncRoute(async (req, res) => {
    const body = z.object({ rating: z.number().int().min(1).max(5), title: z.string().trim().max(120).optional(), body: z.string().trim().min(10).max(2000) }).parse(req.body);
    const school = await PublicSchool.findOne({ slug: req.params.slug, isPublic: true }).lean();
    if (!school || String(school.schoolId) !== req.auth.schoolId)
        return res.status(404).json({ message: 'Review is available only for your school' });
    const hasLink = req.auth.role === 'parent' ? await Student.exists({ guardianIds: req.auth.sub, status: 'active' }) : await Student.exists({ userId: req.auth.sub, status: 'active' });
    if (!hasLink)
        return res.status(403).json({ message: 'An active student or guardian relationship is required to review this school' });
    const review = await runInScope({ system: true }, () => Review.findOneAndUpdate({ schoolId: school.schoolId, reviewerId: req.auth.sub }, { $set: { rating: body.rating, title: body.title || '', body: body.body, moderationStatus: 'pending' }, $setOnInsert: { schoolId: school.schoolId, reviewerId: req.auth.sub } }, { upsert: true, new: true, setDefaultsOnInsert: true }));
    res.status(201).json({ review, moderation: 'pending' });
}));
applicantRouter.use(authenticate, requireTokenType('applicant'));
applicantRouter.get('/profile', asyncRoute(async (req, res) => {
    const [user, profile] = await Promise.all([User.findById(req.auth?.sub).select('name email').lean(), ApplicantProfile.findOne({ userId: req.auth?.sub }).lean()]);
    res.json({ user, profile });
}));
applicantRouter.get('/inquiries', asyncRoute(async (req, res) => {
    const items = await runInScope({ system: true, userId: req.auth.sub }, () => AdmissionInquiry.find({ applicantUserId: req.auth.sub }).sort({ createdAt: -1 }).lean());
    res.json(items);
}));
applicantRouter.get('/applications', asyncRoute(async (req, res) => {
    const items = await runInScope({ system: true, userId: req.auth.sub }, () => AdmissionApplication.find({ applicantUserId: req.auth.sub }).sort({ createdAt: -1 }).lean());
    res.json(items);
}));
applicantRouter.post('/schools/:slug/applications', asyncRoute(async (req, res) => {
    const body = z.object({ studentName: z.string().trim().min(2).max(160), dateOfBirth: z.string().optional(), requestedGrade: z.string().trim().min(1).max(100), academicYearId: z.string().optional(), inquiryId: z.string().optional() }).parse(req.body);
    if (emailVerificationRequired() && !(await User.exists({ _id: req.auth.sub, emailVerifiedAt: { $ne: null } })))
        return res.status(403).json({ code: 'email_not_verified', message: 'Please confirm your email address (check your inbox) before submitting an application.' });
    const pub = await PublicSchool.findOne({ slug: req.params.slug, isPublic: true }).lean();
    if (!pub || !await School.exists({ _id: pub.schoolId, status: 'active' }))
        return res.status(404).json({ message: 'School not found' });
    if (!await hasSchoolFeature(String(pub.schoolId), 'admissions'))
        return res.status(403).json({ message: 'Online applications are not enabled for this school plan' });
    const schoolId = String(pub.schoolId), userId = req.auth.sub;
    const application = await runInScope({ schoolId, userId }, async () => {
        if (body.inquiryId && !await AdmissionInquiry.exists({ _id: body.inquiryId, applicantUserId: userId }))
            throw Object.assign(new Error('Inquiry does not belong to you at this school'), { statusCode: 400 });
        return AdmissionApplication.create({ applicantUserId: userId, inquiryId: body.inquiryId || null, studentName: body.studentName,
            dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null, requestedGrade: body.requestedGrade,
            academicYearId: body.academicYearId || null, status: 'submitted' });
    });
    res.status(201).json(application);
}));
applicantRouter.get('/inquiries/:inquiryId/messages', asyncRoute(async (req, res) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.inquiryId))
        return res.status(400).json({ message: 'Invalid inquiry id' });
    const inquiry = await runInScope({ system: true }, () => AdmissionInquiry.findOne({ _id: req.params.inquiryId, applicantUserId: req.auth.sub }).lean());
    if (!inquiry)
        return res.status(404).json({ message: 'Inquiry not found' });
    const messages = await runInScope({ system: true }, () => import('../models.js').then(m => m.InquiryMessage.find({ inquiryId: inquiry._id }).sort({ createdAt: 1 }).lean()));
    res.json(messages);
}));
applicantRouter.post('/inquiries/:inquiryId/messages', asyncRoute(async (req, res) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.inquiryId))
        return res.status(400).json({ message: 'Invalid inquiry id' });
    const body = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
    const inquiry = await runInScope({ system: true }, () => AdmissionInquiry.findOne({ _id: req.params.inquiryId, applicantUserId: req.auth.sub }).lean());
    if (!inquiry)
        return res.status(404).json({ message: 'Inquiry not found' });
    const message = await runInScope({ schoolId: String(inquiry.schoolId), userId: req.auth.sub, role: 'applicant' }, () => import('../models.js').then(m => m.InquiryMessage.create({ schoolId: inquiry.schoolId, inquiryId: inquiry._id, senderUserId: req.auth.sub, senderType: 'applicant', body: body.body })));
    res.status(201).json(message);
}));
