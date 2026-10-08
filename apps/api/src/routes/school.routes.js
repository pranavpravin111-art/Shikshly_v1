import { Router } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { AcademicYear, AppReview, AuditLog, Classroom, Invite, Membership, PublicSchool, Review, School, SchoolProfile, Student, Subscription, TeacherAssignment, User, UserPreference } from '../models.js';
import { asyncRoute, audit, id, paginatedLimit, validId } from '../helpers.js';
import { authenticate, requireFeature, requirePermission, requireRoles } from '../middleware/auth.js';
import { runInScope } from '../tenant-scope.js';
import { dateRange } from './platform.routes.js';
import { Session } from '../models.js';
import { Plan, ImportJob, ImportRow } from '../models.js';
import { createImportJob, commitImportJob, csvTemplate } from '../services/student-import.service.js';
export const schoolRouter = Router();
schoolRouter.use(authenticate);
schoolRouter.get('/app-rating/me', asyncRoute(async (req, res) => {
    const review = await AppReview.findOne({ userId: id(req.auth.sub) }).lean();
    res.json(review || null);
}));
schoolRouter.put('/app-rating/me', asyncRoute(async (req, res) => {
    const body = z.object({ rating: z.number().int().min(1).max(5), feedback: z.string().trim().max(2000).optional(), platform: z.enum(['web','android','ios','unknown']).optional(), appVersion: z.string().trim().max(40).optional() }).strict().parse(req.body);
    const review = await AppReview.findOneAndUpdate({ userId: id(req.auth.sub) }, { $set: { ...body, moderationStatus: 'published' }, $setOnInsert: { userId: id(req.auth.sub) } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    await audit(req, 'app.review_submitted', 'app_review', review._id, { rating: review.rating });
    res.json(review);
}));
schoolRouter.get('/settings', asyncRoute(async (req, res) => {
    const [user, preferences] = await Promise.all([User.findById(req.auth.sub).select('name email phone status').lean(), UserPreference.findOne({ userId: id(req.auth.sub) }).lean()]);
    res.json({ user, preferences: preferences || { theme: 'system', language: 'en', emailNotifications: true, smsNotifications: true, productUpdates: true } });
}));
schoolRouter.patch('/settings', asyncRoute(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(160).optional(), phone: z.string().trim().max(40).optional(), theme: z.enum(['system', 'light', 'dark']).optional(), language: z.enum(['en', 'hi']).optional(), emailNotifications: z.boolean().optional(), smsNotifications: z.boolean().optional(), productUpdates: z.boolean().optional() }).strict().parse(req.body);
    const userFields = {};
    if (body.name !== undefined) userFields.name = body.name;
    if (body.phone !== undefined) userFields.phone = body.phone;
    const prefFields = {};
    for (const key of ['theme','language','emailNotifications','smsNotifications','productUpdates']) if (body[key] !== undefined) prefFields[key] = body[key];
    if (Object.keys(userFields).length) await User.findByIdAndUpdate(req.auth.sub, { $set: userFields });
    const preferences = await UserPreference.findOneAndUpdate({ userId: id(req.auth.sub) }, { $set: prefFields, $setOnInsert: { userId: id(req.auth.sub) } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
    if (Object.keys(userFields).length || Object.keys(prefFields).length) await audit(req, 'settings.updated', 'user_settings', req.auth.sub, { fields: [...Object.keys(userFields), ...Object.keys(prefFields)] });
    const user = await User.findById(req.auth.sub).select('name email phone status').lean();
    res.json({ user, preferences });
}));
schoolRouter.get('/profile', requirePermission('school.profile.manage'), asyncRoute(async (req, res) => {
    res.json(await SchoolProfile.findOne({}).lean() || null);
}));
schoolRouter.patch('/profile', requireFeature('public_page'), requirePermission('school.profile.manage'), asyncRoute(async (req, res) => {
    const schema = z.object({ publicName: z.string().trim().max(160).optional(), area: z.string().trim().max(120).optional(), address: z.string().trim().max(300).optional(),
        city: z.string().trim().max(120).optional(), state: z.string().trim().max(120).optional(), country: z.string().trim().max(100).optional(),
        postalCode: z.string().trim().max(24).optional(), latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(),
        description: z.string().trim().max(3000).optional(), phone: z.string().max(40).optional(), email: z.string().email().max(320).optional(), website: z.string().url().max(400).optional(),
        timeZone: z.string().max(100).optional(), isPublic: z.boolean().optional(), photos: z.array(z.string().max(2000).regex(/^https:\/\/[^\s()'"\\<>]+$/, 'Photo links must be https:// addresses')).max(500).optional(), facilities: z.array(z.string().trim().max(100)).max(50).optional() }).strict();
    const body = schema.parse(req.body), schoolId = req.auth.schoolId;
    if (!Object.keys(body).length)
        return res.status(400).json({ message: 'Provide at least one profile field' });
    if (body.photos) {
        const sub = await Subscription.findOne({}).lean(), plan = sub ? await Plan.findOne({ key: sub.planKey }).lean() : null;
        const maximum = plan?.limits?.photos;
        if (typeof maximum === 'number' && body.photos.length > maximum)
            return res.status(400).json({ message: `This plan allows at most ${maximum} photos`, maximum });
    }
    const profile = await SchoolProfile.findOneAndUpdate({}, { $set: body }, { new: true, upsert: true, setDefaultsOnInsert: true });
    const school = await School.findById(schoolId).lean();
    await runInScope({ system: true }, () => PublicSchool.findOneAndUpdate({ schoolId: id(schoolId) }, { $set: {
            schoolId: id(schoolId), slug: school.slug, name: body.publicName ?? profile.publicName ?? school.name, area: profile.area, city: profile.city, state: profile.state, country: profile.country,
            latitude: profile.latitude, longitude: profile.longitude, description: profile.description, phone: profile.phone, email: profile.email, website: profile.website,
            photos: profile.photos, facilities: profile.facilities, isPublic: profile.isPublic,
        } }, { upsert: true, new: true, setDefaultsOnInsert: true }));
    await audit(req, 'school.profile_updated', 'school_profile', schoolId, { fields: Object.keys(body) });
    res.json(profile);
}));
schoolRouter.post('/invites', requireFeature('students'), requirePermission('invites.create'), asyncRoute(async (req, res) => {
    const body = z.object({ role: z.enum(['principal', 'admission_staff', 'accountant', 'teacher', 'librarian', 'bus_driver', 'parent', 'student']), studentId: z.string().optional(), days: z.number().int().min(1).max(30).default(7), maxUses: z.number().int().min(1).max(500).default(1) }).parse(req.body);
    if (body.role === 'principal' && req.auth.role !== 'owner')
        return res.status(403).json({ message: 'Only the owner can appoint a principal' });
    if (['parent', 'student'].includes(body.role) && !validId(body.studentId))
        return res.status(400).json({ message: 'studentId is required for parent/student invites' });
    const required = body.role === 'librarian' ? 'library' : body.role === 'bus_driver' ? 'transport' : null;
    if (required) {
        const sub = await Subscription.findOne({}).lean();
        const plan = sub ? await runInScope({ system: true }, () => import('../models.js').then(m => m.Plan.findOne({ key: sub.planKey }).lean())) : null;
        if (!plan?.features?.includes(required))
            return res.status(403).json({ message: `${body.role} invitations require the ${required} plan feature` });
    }
    if (body.studentId && !await Student.exists({ _id: body.studentId }))
        return res.status(404).json({ message: 'Student not found in this school' });
    const code = `${body.role.slice(0, 1).toUpperCase()}-${randomBytes(7).toString('hex').toUpperCase()}`;
    const invite = await Invite.create({ role: body.role, codeHash: createHash('sha256').update(code).digest('hex'), maxUses: body.role === 'student' ? 1 : body.maxUses,
        linkedStudentId: body.studentId ? id(body.studentId) : null, expiresAt: new Date(Date.now() + body.days * 86400000), createdBy: id(req.auth.sub) });
    await audit(req, 'invite.created', 'invite', invite._id, { role: body.role, studentId: body.studentId || null });
    const school = await School.findById(req.auth.schoolId).lean();
    const appBase = (process.env.APP_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
    const joinUrl = `${appBase}/join/${encodeURIComponent(code)}`;
    const installTemplate = process.env.APP_INSTALL_URL?.trim() || `${appBase}/download?invite={code}`;
    const installUrl = installTemplate.replaceAll('{code}', encodeURIComponent(code));
    const expiry = invite.expiresAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const shareMessage = [`You are invited to join ${school?.name || 'your school'} as ${body.role.replace('_', ' ')}.`, `Install or open Shikshly: ${installUrl}`,
        `Invite code: ${code}`, `Join on the web: ${joinUrl}`, `Code expires: ${expiry} (India time).`].join('\n');
    res.status(201).json({ id: invite._id, code, role: invite.role, schoolName: school?.name, expiresAt: invite.expiresAt, joinUrl, installUrl, shareMessage });
}));
schoolRouter.get('/invites', requirePermission('invites.create'), asyncRoute(async (_req, res) => {
    res.json(await Invite.find({}).select('-codeHash').sort({ createdAt: -1 }).limit(300).lean());
}));
schoolRouter.post('/invites/:inviteId/revoke', requirePermission('invites.create'), asyncRoute(async (req, res) => {
    if (!validId(req.params.inviteId))
        return res.status(400).json({ message: 'Invalid invite id' });
    const row = await Invite.findOneAndUpdate({ _id: req.params.inviteId, status: 'active' }, { $set: { status: 'revoked' } }, { new: true });
    if (!row)
        return res.status(404).json({ message: 'Active invite not found' });
    await audit(req, 'invite.revoked', 'invite', row._id);
    res.json({ revoked: true });
}));
schoolRouter.get('/members', requireRoles('owner', 'principal'), asyncRoute(async (_req, res) => {
    const memberships = await Membership.find({ status: 'active' }).sort({ role: 1 }).lean();
    const users = await User.find({ _id: { $in: memberships.map(m => m.userId) } }).select('name email phone').lean();
    res.json(memberships.map(m => ({ ...m, user: users.find(u => String(u._id) === String(m.userId)) || null })));
}));
schoolRouter.post('/academic-years', requireFeature('students'), requirePermission('academic.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(80), startDate: z.string().date(), endDate: z.string().date(), makeCurrent: z.boolean().default(false) }).parse(req.body);
    if (body.endDate <= body.startDate)
        return res.status(400).json({ message: 'endDate must be after startDate' });
    if (body.makeCurrent)
        await AcademicYear.updateMany({ isCurrent: true }, { $set: { isCurrent: false } });
    const year = await AcademicYear.create({ name: body.name, startDate: new Date(body.startDate), endDate: new Date(body.endDate), isCurrent: body.makeCurrent });
    await audit(req, 'academic_year.created', 'academic_year', year._id);
    res.status(201).json(year);
}));
schoolRouter.get('/academic-years', requireFeature('students'), requirePermission('classes.view'), asyncRoute(async (_req, res) => {
    res.json(await AcademicYear.find({}).sort({ startDate: -1 }).lean());
}));
schoolRouter.post('/academic-years/:yearId/current', requirePermission('academic.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.yearId))
        return res.status(400).json({ message: 'Invalid academic year' });
    const year = await AcademicYear.findById(req.params.yearId);
    if (!year)
        return res.status(404).json({ message: 'Academic year not found' });
    await AcademicYear.updateMany({ isCurrent: true }, { $set: { isCurrent: false } });
    year.isCurrent = true;
    await year.save();
    await audit(req, 'academic_year.set_current', 'academic_year', year._id);
    res.json({ current: String(year._id) });
}));
schoolRouter.post('/classes', requireFeature('students'), requirePermission('classes.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(1).max(80), section: z.string().trim().max(40).default(''), academicYearId: z.string().optional() }).parse(req.body);
    const year = body.academicYearId ? await AcademicYear.findById(body.academicYearId) : await AcademicYear.findOne({ isCurrent: true });
    if (!year)
        return res.status(400).json({ message: 'Create and set a current academic year first' });
    const room = await Classroom.create({ academicYearId: year._id, name: body.name, section: body.section, teacherIds: [] });
    await audit(req, 'class.created', 'classroom', room._id, { academicYearId: String(year._id) });
    res.status(201).json(room);
}));
schoolRouter.get('/classes', requireFeature('students'), requirePermission('classes.view'), asyncRoute(async (req, res) => {
    const year = typeof req.query.academicYearId === 'string' ? req.query.academicYearId : undefined;
    const filter = { ...(year ? { academicYearId: id(year) } : {}) };
    if (req.auth.role === 'teacher')
        filter._id = { $in: (await TeacherAssignment.find({ teacherId: id(req.auth.sub) }).distinct('classId')) };
    const rows = await Classroom.find(filter).sort({ name: 1, section: 1 }).limit(300).lean();
    res.json(rows);
}));
schoolRouter.post('/classes/:classId/teachers', requireFeature('students'), requirePermission('classes.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.classId))
        return res.status(400).json({ message: 'Invalid class id' });
    const body = z.object({ teacherUserId: z.string(), subject: z.string().trim().min(1).max(120) }).parse(req.body);
    const teacherId = id(body.teacherUserId), room = await Classroom.findById(req.params.classId);
    if (!room)
        return res.status(404).json({ message: 'Class not found' });
    if (!await Membership.exists({ userId: teacherId, role: 'teacher', status: 'active' }))
        return res.status(400).json({ message: 'Teacher must be an active member of this school' });
    const assignment = await TeacherAssignment.findOneAndUpdate({ teacherId, classId: room._id, subject: body.subject }, { $setOnInsert: { teacherId, classId: room._id, subject: body.subject } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    if (!room.teacherIds.some((t) => String(t) === String(teacherId))) {
        room.teacherIds.push(teacherId);
        await room.save();
    }
    await audit(req, 'class.teacher_assigned', 'classroom', room._id, { teacherUserId: body.teacherUserId, subject: body.subject });
    res.status(201).json(assignment);
}));
schoolRouter.post('/students', requireFeature('students'), requirePermission('students.create'), asyncRoute(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(160), admissionNo: z.string().trim().max(80).optional(), classId: z.string(), dateOfBirth: z.string().date().optional() }).parse(req.body);
    if (!await Classroom.exists({ _id: body.classId }))
        return res.status(400).json({ message: 'classId is not in this school' });
    const student = await Student.create({ name: body.name, admissionNo: body.admissionNo || undefined, classId: id(body.classId), dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null });
    await audit(req, 'student.created', 'student', student._id, { classId: body.classId });
    res.status(201).json(student);
}));
schoolRouter.post('/admissions/direct', requireFeature('admissions'), requirePermission('admissions.create_direct'), asyncRoute(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(160), admissionNo: z.string().trim().min(1).max(80), classId: z.string(), academicYearId: z.string(), dateOfBirth: z.string().date().optional(), gender: z.string().trim().max(40).optional(), admissionDate: z.string().date().optional(), fatherName: z.string().trim().max(160).optional(), fatherPhone: z.string().trim().max(40).optional(), motherName: z.string().trim().max(160).optional(), motherPhone: z.string().trim().max(40).optional(), guardianName: z.string().trim().max(160).optional(), guardianPhone: z.string().trim().max(40).optional(), guardianEmail: z.string().email().optional(), address: z.string().trim().max(300).optional(), city: z.string().trim().max(120).optional(), state: z.string().trim().max(120).optional(), postalCode: z.string().trim().max(24).optional(), previousSchool: z.string().trim().max(200).optional(), tcNumber: z.string().trim().max(100).optional() }).strict().parse(req.body);
    if (!validId(body.classId) || !validId(body.academicYearId)) return res.status(400).json({ message: 'Class or academic year is invalid' });
    const classroom = await Classroom.findOne({ _id: id(body.classId), academicYearId: id(body.academicYearId) }).lean();
    if (!classroom) return res.status(400).json({ message: 'Class does not belong to the selected academic year' });
    if (await Student.exists({ admissionNo: body.admissionNo })) return res.status(409).json({ message: 'Admission number already exists' });
    const student = await Student.create({ ...body, dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null, admissionDate: body.admissionDate ? new Date(body.admissionDate) : new Date(), classId: id(body.classId), academicYearId: id(body.academicYearId), guardians: [{ relationship:'father', name:body.fatherName||'', phone:body.fatherPhone||'' },{ relationship:'mother', name:body.motherName||'', phone:body.motherPhone||'' },{ relationship:'guardian', name:body.guardianName||'', phone:body.guardianPhone||'', email:body.guardianEmail||'' }].filter(g=>g.name||g.phone||g.email), address:{line1:body.address||'',city:body.city||'',state:body.state||'',postalCode:body.postalCode||''}, previousSchool:{name:body.previousSchool||'',tcNumber:body.tcNumber||''} });
    await audit(req, 'admission.direct_student_created', 'student', student._id, { classId: body.classId, academicYearId: body.academicYearId });
    res.status(201).json(student);
}));
schoolRouter.get('/students/import-template', requireFeature('students'), requirePermission('students.import'), asyncRoute(async (_req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=shikshly-student-import-template.csv');
    res.send(csvTemplate());
}));
schoolRouter.get('/students/import-jobs', requireFeature('students'), requirePermission('students.import'), asyncRoute(async (req, res) => {
    res.json(await ImportJob.find({}).sort({ createdAt: -1 }).limit(50).lean());
}));
schoolRouter.get('/students/import-jobs/:jobId', requireFeature('students'), requirePermission('students.import'), asyncRoute(async (req, res) => {
    if (!validId(req.params.jobId)) return res.status(400).json({ message: 'Invalid import job id' });
    const job = await ImportJob.findById(req.params.jobId).lean();
    if (!job) return res.status(404).json({ message: 'Import job not found' });
    const errors = await ImportRow.find({ importJobId: job._id, status: 'error' }).select('rowNumber errors warnings').sort({ rowNumber: 1 }).limit(500).lean();
    res.json({ job, errors });
}));
schoolRouter.post('/students/import', requireFeature('students'), requirePermission('students.import'), asyncRoute(async (req, res) => {
    const body = z.object({ fileName: z.string().trim().min(1).max(200), content: z.string().min(1).max(10 * 1024 * 1024), mode: z.enum(['create_only', 'update_existing']).default('create_only') }).strict().parse(req.body);
    const job = await createImportJob({ actorId: req.auth.sub, fileName: body.fileName, csvText: body.content, mode: body.mode });
    await audit(req, 'student.import.validated', 'import_job', job._id, { fileName: body.fileName, totalRows: job.totalRows, validRows: job.validRows, invalidRows: job.invalidRows, mode: job.mode });
    res.status(201).json(job);
}));
schoolRouter.post('/students/import-jobs/:jobId/commit', requireFeature('students'), requirePermission('students.import'), asyncRoute(async (req, res) => {
    if (!validId(req.params.jobId)) return res.status(400).json({ message: 'Invalid import job id' });
    const job = await commitImportJob(req.params.jobId, req.auth.sub);
    await audit(req, 'student.import.committed', 'import_job', job._id, { createdRows: job.createdRows, updatedRows: job.updatedRows, failedRows: job.failedRows });
    res.json(job);
}));

schoolRouter.get('/students', requireFeature('students'), requirePermission('students.view'), asyncRoute(async (req, res) => {
    const filter = { status: 'active' };
    if (req.auth.role === 'teacher')
        filter.classId = { $in: await TeacherAssignment.find({ teacherId: id(req.auth.sub) }).distinct('classId') };
    if (req.auth.role === 'parent')
        filter.guardianIds = id(req.auth.sub);
    if (req.auth.role === 'student')
        filter.userId = id(req.auth.sub);
    res.json(await Student.find(filter).select('name admissionNo classId academicYearId dateOfBirth status').sort({ name: 1 }).limit(paginatedLimit(req.query.limit)).lean());
}));
schoolRouter.get('/students/export.csv', requireFeature('students'), requirePermission('students.export'), asyncRoute(async (req, res) => {
    const filter = {};
    if (typeof req.query.classId === 'string' && validId(req.query.classId)) filter.classId = id(req.query.classId);
    if (typeof req.query.academicYearId === 'string' && validId(req.query.academicYearId)) filter.academicYearId = id(req.query.academicYearId);
    if (typeof req.query.status === 'string' && ['active','transferred','graduated','inactive'].includes(req.query.status)) filter.status = req.query.status;
    const total = await Student.countDocuments(filter);
    if (total > 25000) return res.status(413).json({ message: 'Export is too large for one CSV. Filter by class, academic year or status and try again.', total, maximum: 25000 });
    const rows = await Student.find(filter).select('name admissionNo firstName middleName lastName dateOfBirth gender admissionDate classId academicYearId guardians address previousSchool status').sort({ name: 1 }).limit(25000).lean();
    const classrooms = await Classroom.find({ _id: { $in: rows.map(r => r.classId).filter(Boolean) } }).select('_id name section').lean();
    const years = await AcademicYear.find({ _id: { $in: rows.map(r => r.academicYearId).filter(Boolean) } }).select('_id name').lean();
    const cm = new Map(classrooms.map(c => [String(c._id), `${c.name}${c.section ? `-${c.section}` : ''}`]));
    const ym = new Map(years.map(y => [String(y._id), y.name]));
    const esc = v => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replaceAll('"','""')}"` : x; };
    const header = ['admission_no','name','date_of_birth','gender','class','academic_year','admission_date','father_name','father_phone','mother_name','mother_phone','guardian_name','guardian_phone','guardian_email','address','city','state','postal_code','previous_school','tc_number','status'];
    const lines = [header.join(',')];
    for (const r of rows) { const g = Array.isArray(r.guardians) ? r.guardians : []; const f = g.find(x => x.relationship === 'father') || {}, m = g.find(x => x.relationship === 'mother') || {}, other = g.find(x => x.relationship === 'guardian') || {}; const d = r.dateOfBirth ? new Date(r.dateOfBirth).toISOString().slice(0,10) : ''; const ad = r.admissionDate ? new Date(r.admissionDate).toISOString().slice(0,10) : ''; lines.push([r.admissionNo,r.name,d,r.gender,cm.get(String(r.classId))||'',ym.get(String(r.academicYearId))||'',ad,f.name,f.phone,m.name,m.phone,other.name,other.phone,other.email,r.address?.line1,r.address?.city,r.address?.state,r.address?.postalCode,r.previousSchool?.name,r.previousSchool?.tcNumber,r.status].map(esc).join(',')); }
    await audit(req, 'student.exported', 'student_export', null, { count: rows.length, filters: req.query });
    res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition','attachment; filename=shikshly-students.csv'); res.send(lines.join('\n'));
}));
schoolRouter.get('/students/:studentId', requireFeature('students'), requirePermission('students.view'), asyncRoute(async (req, res) => {
    if (!validId(req.params.studentId))
        return res.status(400).json({ message: 'Invalid student id' });
    const filter = { _id: req.params.studentId };
    if (req.auth.role === 'teacher')
        filter.classId = { $in: await TeacherAssignment.find({ teacherId: id(req.auth.sub) }).distinct('classId') };
    if (req.auth.role === 'parent')
        filter.guardianIds = id(req.auth.sub);
    if (req.auth.role === 'student')
        filter.userId = id(req.auth.sub);
    const student = await Student.findOne(filter).lean();
    if (!student)
        return res.status(404).json({ message: 'Student not found' });
    res.json(student);
}));
schoolRouter.get('/activity', requirePermission('audit.view'), asyncRoute(async (req, res) => {
    const sub = await Subscription.findOne({}).lean();
    const { Plan } = await import('../models.js');
    const plan = sub ? await Plan.findOne({ key: sub.planKey }).lean() : null;
    if (!plan?.features?.some((f) => f.startsWith('activity.')))
        return res.status(403).json({ message: 'Activity monitoring is not included in the current plan' });
    const max = plan.features.includes('activity.export') ? 2000 : plan.features.includes('activity.full') ? 500 : 50;
    // Optional filters: ?action=attendance.marked  ?entity=student  ?actorId=<user id>  ?from=YYYY-MM-DD  ?to=YYYY-MM-DD
    const filter = {};
    if (typeof req.query.action === 'string')
        filter.action = req.query.action.slice(0, 80);
    if (typeof req.query.entity === 'string')
        filter.entity = req.query.entity.slice(0, 80);
    if (typeof req.query.actorId === 'string') {
        if (!validId(req.query.actorId))
            return res.status(400).json({ message: 'Invalid actor id' });
        filter.actorId = id(req.query.actorId);
    }
    const range = dateRange(req.query.from, req.query.to);
    if (range === 'invalid')
        return res.status(400).json({ message: 'from/to must be YYYY-MM-DD' });
    if (range)
        filter.createdAt = range;
    const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(paginatedLimit(req.query.limit, max)).lean();
    const actors = await User.find({ _id: { $in: rows.map((r) => r.actorId).filter(Boolean) } }).select('name').lean();
    res.json(rows.map((r) => ({ ...r, actorName: actors.find((u) => String(u._id) === String(r.actorId))?.name || 'Unknown' })));
}));
// Sign-in history for this school (who signed in, on which device, when). Owner and principal only. No IP addresses are returned.
schoolRouter.get('/history/sign-ins', requireRoles('owner', 'principal'), asyncRoute(async (req, res) => {
    const rows = await runInScope({ system: true }, () => Session.find({ schoolId: id(req.auth.schoolId), tokenType: 'member' }).select('userId role device userAgent createdAt expiresAt revokedAt').sort({ createdAt: -1 }).limit(paginatedLimit(req.query.limit, 300)).lean());
    const users = await runInScope({ system: true }, () => User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('name').lean());
    res.json(rows.map((r) => ({ at: r.createdAt, name: users.find((u) => String(u._id) === String(r.userId))?.name || 'Unknown', role: r.role, device: r.device || '', browser: String(r.userAgent || '').slice(0, 80), signedOut: !!r.revokedAt, active: !r.revokedAt && r.expiresAt > new Date() })));
}));
schoolRouter.get('/reviews', requireRoles('owner', 'principal'), asyncRoute(async (req, res) => res.json(await runInScope({ system: true }, () => Review.find({ schoolId: id(req.auth.schoolId) }).sort({ createdAt: -1 }).limit(200).lean()))));
schoolRouter.patch('/reviews/:reviewId', requireRoles('owner', 'principal'), asyncRoute(async (req, res) => {
    if (!validId(req.params.reviewId))
        return res.status(400).json({ message: 'Invalid review id' });
    const body = z.object({ moderationStatus: z.enum(['approved', 'rejected']) }).parse(req.body);
    const schoolId = id(req.auth.schoolId);
    const review = await runInScope({ system: true }, () => Review.findOneAndUpdate({ _id: id(req.params.reviewId), schoolId }, { $set: { moderationStatus: body.moderationStatus } }, { new: true }));
    if (!review)
        return res.status(404).json({ message: 'Review not found for this school' });
    const [stats] = await runInScope({ system: true }, () => Review.aggregate([{ $match: { schoolId, moderationStatus: 'approved' } }, { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } }]));
    await runInScope({ system: true }, () => PublicSchool.findOneAndUpdate({ schoolId }, { $set: { rating: stats?.average || 0, reviewCount: stats?.count || 0 } }));
    await audit(req, 'school.review_moderated', 'review', review._id, { status: body.moderationStatus });
    res.json(review);
}));
