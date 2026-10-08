import { Router } from 'express';
import { z } from 'zod';
import { Attendance, Classroom, Exam, FeePayment, Homework, HomeworkSubmission, Notification, Student, TeacherAssignment } from '../models.js';
import { asyncRoute, audit, id, validId } from '../helpers.js';
import { authenticate, requireFeature, requirePermission, requireRoles, schoolFeatures } from '../middleware/auth.js';
export const learningRouter = Router();
learningRouter.use(authenticate);
async function canTeacherUseClass(req, classId) {
    return req.auth.role !== 'teacher' || !!await TeacherAssignment.exists({ teacherId: id(req.auth.sub), classId: id(classId) });
}
async function visibleStudentFilter(req, studentId) {
    const student = await Student.findById(studentId).lean();
    if (!student)
        return false;
    if (req.auth.role === 'parent')
        return student.guardianIds.some((v) => String(v) === req.auth.sub);
    if (req.auth.role === 'student')
        return String(student.userId) === req.auth.sub;
    if (req.auth.role === 'teacher')
        return !!await TeacherAssignment.exists({ teacherId: id(req.auth.sub), classId: student.classId });
    return true;
}
learningRouter.get('/attendance/classes/:classId/:date', requireFeature('attendance'), requirePermission('attendance.view'), asyncRoute(async (req, res) => {
    const { classId, date } = req.params;
    if (!validId(classId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
        return res.status(400).json({ message: 'classId or date is invalid' });
    if (!await canTeacherUseClass(req, classId))
        return res.status(404).json({ message: 'Class not found' });
    const roster = await Student.find({ classId: id(classId), status: 'active' }).select('name admissionNo').lean();
    const records = await Attendance.find({ classId: id(classId), date }).lean();
    res.json(roster.map(s => ({ ...s, attendance: records.find(a => String(a.studentId) === String(s._id)) || null })));
}));
learningRouter.post('/attendance/classes/:classId/:date', requireFeature('attendance'), requirePermission('attendance.mark'), asyncRoute(async (req, res) => {
    const { classId, date } = req.params;
    const body = z.object({ records: z.array(z.object({ studentId: z.string(), status: z.enum(['present', 'absent', 'late', 'excused']), note: z.string().max(1000).optional() })).min(1).max(300) }).parse(req.body);
    if (!validId(classId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
        return res.status(400).json({ message: 'classId or date is invalid' });
    const profile = await (await import('../models.js')).SchoolProfile.findOne({}).select('timeZone').lean();
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: profile?.timeZone || 'Asia/Kolkata' }).format(new Date());
    if (date > localDate)
        return res.status(400).json({ message: 'Attendance date cannot be in the future in the school timezone' });
    if (!await Classroom.exists({ _id: classId }) || !await canTeacherUseClass(req, classId))
        return res.status(404).json({ message: 'Class not found' });
    const ids = body.records.map(r => r.studentId);
    if (new Set(ids).size !== ids.length || ids.some(i => !validId(i)))
        return res.status(400).json({ message: 'Student IDs must be valid and unique' });
    const roster = await Student.find({ _id: { $in: ids }, classId: id(classId) }).select('_id').lean();
    if (roster.length !== ids.length)
        return res.status(400).json({ message: 'Every student must belong to this class' });
    const records = [];
    for (const record of body.records) {
        const saved = await Attendance.findOneAndUpdate({ studentId: id(record.studentId), date }, { $set: { classId: id(classId), status: record.status, note: record.note || '', markedBy: id(req.auth.sub) } }, { upsert: true, new: true, setDefaultsOnInsert: true });
        records.push(saved);
    }
    await audit(req, 'attendance.marked', 'classroom', classId, { date, count: records.length });
    res.json({ date, count: records.length, records });
}));
learningRouter.get('/attendance/students/:studentId', requireFeature('attendance'), requirePermission('attendance.view'), asyncRoute(async (req, res) => {
    if (!validId(req.params.studentId) || !await visibleStudentFilter(req, req.params.studentId))
        return res.status(404).json({ message: 'Student not found' });
    const from = typeof req.query.from === 'string' ? req.query.from : undefined, to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const filter = { studentId: id(req.params.studentId) };
    if (from || to)
        filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    res.json(await Attendance.find(filter).sort({ date: -1 }).limit(366).lean());
}));
learningRouter.get('/me/children/:studentId/attendance/last-30-days', requireFeature('attendance'), requireRoles('parent'), asyncRoute(async (req, res) => {
    const studentId = req.params.studentId;
    if (!validId(studentId))
        return res.status(404).json({ message: 'Student not found' });
    const student = await Student.findOne({ _id: id(studentId), guardianIds: id(req.auth.sub), status: 'active' }).select('name admissionNo classId').lean();
    if (!student)
        return res.status(404).json({ message: 'Student not found' });
    const profile = await (await import('../models.js')).SchoolProfile.findOne({}).select('timeZone').lean();
    const timeZone = profile?.timeZone || 'Asia/Kolkata';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
    const dayKeys = Array.from({ length: 30 }, (_, i) => {
        const day = new Date(`${today}T12:00:00Z`);
        day.setUTCDate(day.getUTCDate() - (29 - i));
        return day.toISOString().slice(0, 10);
    });
    const start = dayKeys[0], end = dayKeys[29];
    const records = await Attendance.find({ studentId: id(studentId), date: { $gte: start, $lte: end } }).select('date status note').lean();
    const byDate = new Map(records.map(r => [r.date, r]));
    const days = dayKeys.map(date => ({ date, status: byDate.get(date)?.status || 'not_recorded', note: byDate.get(date)?.note || '' }));
    const counts = { present: 0, absent: 0, late: 0, excused: 0, notRecorded: 0 };
    for (const day of days) {
        if (day.status === 'not_recorded')
            counts.notRecorded++;
        else
            counts[day.status]++;
    }
    const marked = 30 - counts.notRecorded;
    res.json({ student, timezone: timeZone, from: start, to: end, days, summary: { ...counts, markedDays: marked, attendanceRate: marked ? Math.round((counts.present + counts.late) / marked * 100) : null } });
}));
learningRouter.post('/attendance/classes/:classId/:date/notifications', requireFeature('notifications'), requirePermission('attendance.notify'), asyncRoute(async (req, res) => {
    const { classId, date } = req.params;
    if (!validId(classId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !await canTeacherUseClass(req, classId))
        return res.status(404).json({ message: 'Class not found' });
    const absences = await Attendance.find({ classId: id(classId), date, status: 'absent' }).lean();
    let queued = 0;
    for (const attendance of absences) {
        const student = await Student.findById(attendance.studentId).lean();
        for (const parentId of student?.guardianIds || []) {
            if (await Notification.exists({ recipientId: parentId, type: 'attendance_absent', metadata: { studentId: String(student._id), date } }))
                continue;
            await Notification.create({ recipientId: parentId, type: 'attendance_absent', message: `${student?.name} was marked absent on ${date}.`, metadata: { studentId: String(student._id), date } });
            queued++;
        }
    }
    await audit(req, 'attendance.notifications_queued', 'classroom', classId, { date, queued });
    res.json({ queued, delivery: 'in_app_queue' });
}));
learningRouter.get('/homework', requireFeature('homework'), requirePermission('homework.view'), asyncRoute(async (req, res) => {
    const filter = { status: 'assigned' };
    if (req.auth.role === 'teacher')
        filter.teacherId = id(req.auth.sub);
    if (req.auth.role === 'student' || req.auth.role === 'parent') {
        const students = await Student.find(req.auth.role === 'student' ? { userId: id(req.auth.sub) } : { guardianIds: id(req.auth.sub) }).select('classId').lean();
        filter.classId = { $in: students.map(s => s.classId).filter(Boolean) };
    }
    if (typeof req.query.classId === 'string' && validId(req.query.classId))
        filter.classId = id(req.query.classId);
    res.json(await Homework.find(filter).sort({ dueAt: 1 }).limit(200).lean());
}));
learningRouter.post('/homework', requireFeature('homework'), requirePermission('homework.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ classId: z.string(), title: z.string().trim().min(2).max(200), instructions: z.string().trim().min(1).max(5000), dueAt: z.string().datetime() }).parse(req.body);
    if (!validId(body.classId) || !await Classroom.exists({ _id: body.classId }) || !await canTeacherUseClass(req, body.classId))
        return res.status(404).json({ message: 'Class not found or not assigned' });
    const homework = await Homework.create({ classId: id(body.classId), teacherId: id(req.auth.sub), title: body.title, instructions: body.instructions, dueAt: new Date(body.dueAt), status: 'assigned' });
    await audit(req, 'homework.created', 'homework', homework._id, { classId: body.classId });
    res.status(201).json(homework);
}));
learningRouter.get('/homework/:homeworkId/submissions', requireFeature('homework'), requirePermission('homework.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.homeworkId))
        return res.status(400).json({ message: 'Invalid homework id' });
    const hw = await Homework.findById(req.params.homeworkId).lean();
    if (!hw || req.auth.role === 'teacher' && String(hw.teacherId) !== req.auth.sub)
        return res.status(404).json({ message: 'Homework not found' });
    const submissions = await HomeworkSubmission.find({ homeworkId: hw._id }).lean();
    const students = await Student.find({ _id: { $in: submissions.map(s => s.studentId) } }).select('name admissionNo').lean();
    res.json(submissions.map(s => ({ ...s, student: students.find(x => String(x._id) === String(s.studentId)) || null })));
}));
learningRouter.post('/homework/:homeworkId/submit', requireFeature('homework'), requireRoles('student'), asyncRoute(async (req, res) => {
    if (!validId(req.params.homeworkId))
        return res.status(400).json({ message: 'Invalid homework id' });
    const body = z.object({ body: z.string().trim().min(1).max(10000) }).parse(req.body);
    const student = await Student.findOne({ userId: id(req.auth.sub) }).lean();
    const hw = await Homework.findById(req.params.homeworkId).lean();
    if (!student || !hw || String(student.classId) !== String(hw.classId))
        return res.status(404).json({ message: 'Homework not found for your class' });
    const submission = await HomeworkSubmission.findOneAndUpdate({ homeworkId: hw._id, studentId: student._id }, { $set: { body: body.body, submittedAt: new Date() } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    await audit(req, 'homework.submitted', 'homework_submission', submission._id, { homeworkId: req.params.homeworkId });
    res.status(201).json(submission);
}));
learningRouter.patch('/homework/submissions/:submissionId/grade', requireFeature('homework'), requirePermission('homework.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.submissionId))
        return res.status(400).json({ message: 'Invalid submission id' });
    const body = z.object({ grade: z.string().trim().max(40), feedback: z.string().trim().max(2000).optional() }).parse(req.body);
    const submission = await HomeworkSubmission.findById(req.params.submissionId);
    if (!submission)
        return res.status(404).json({ message: 'Submission not found' });
    const hw = await Homework.findById(submission.homeworkId).lean();
    if (!hw || req.auth.role === 'teacher' && String(hw.teacherId) !== req.auth.sub)
        return res.status(404).json({ message: 'Submission not found' });
    submission.grade = body.grade;
    submission.feedback = body.feedback || '';
    await submission.save();
    await audit(req, 'homework.graded', 'homework_submission', submission._id, { homeworkId: String(hw._id) });
    res.json(submission);
}));
learningRouter.get('/me/notifications', authenticate, asyncRoute(async (req, res) => {
    res.json(await Notification.find({ recipientId: id(req.auth.sub) }).sort({ createdAt: -1 }).limit(100).lean());
}));
learningRouter.post('/me/notifications/:notificationId/read', authenticate, asyncRoute(async (req, res) => {
    if (!validId(req.params.notificationId))
        return res.status(400).json({ message: 'Invalid notification id' });
    const notification = await Notification.findOneAndUpdate({ _id: req.params.notificationId, recipientId: id(req.auth.sub), readAt: null }, { $set: { readAt: new Date() } }, { new: true });
    if (!notification)
        return res.status(404).json({ message: 'Notification not found' });
    res.json({ read: true });
}));
/**
 * One child's history, newest first, for a parent (or the student themself).
 * Only sections the school's plan includes are returned, and only records about this child.
 *   ?days=90 (1-365)   ?types=attendance,fees,homework,exams,notifications
 */
learningRouter.get('/me/children/:studentId/history', requireRoles('parent', 'student'), asyncRoute(async (req, res) => {
    const studentId = req.params.studentId;
    if (!validId(studentId))
        return res.status(404).json({ message: 'Student not found' });
    const own = req.auth.role === 'parent' ? { guardianIds: id(req.auth.sub) } : { userId: id(req.auth.sub) };
    const student = await Student.findOne({ _id: id(studentId), status: 'active', ...own }).select('name admissionNo classId').lean();
    if (!student)
        return res.status(404).json({ message: 'Student not found' });
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));
    const wanted = new Set(typeof req.query.types === 'string' ? req.query.types.split(',').map(x => x.trim()) : ['attendance', 'fees', 'homework', 'exams', 'notifications']);
    const features = await schoolFeatures();
    const since = new Date(Date.now() - days * 86_400_000), sinceDay = since.toISOString().slice(0, 10);
    const items = [];
    const money = (p) => `\u20b9${((p || 0) / 100).toLocaleString('en-IN')}`;
    if (wanted.has('attendance') && features.includes('attendance'))
        for (const a of await Attendance.find({ studentId: student._id, date: { $gte: sinceDay } }).sort({ date: -1 }).limit(400).lean())
            items.push({ type: 'attendance', at: `${a.date}T00:00:00.000Z`, title: `Marked ${a.status}`, detail: a.note || undefined });
    if (wanted.has('fees') && features.includes('fees'))
        for (const p of await FeePayment.find({ studentId: student._id, status: 'paid', paidAt: { $gte: since } }).sort({ paidAt: -1 }).limit(200).lean())
            items.push({ type: 'fees', at: new Date(p.paidAt).toISOString(), title: `Fee payment received: ${money(p.amountPaise)}`, detail: `Receipt ${p.receiptNo} (${p.method})` });
    if (wanted.has('homework') && features.includes('homework') && student.classId)
        for (const h of await Homework.find({ classId: student.classId, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(200).lean()) {
            const sub = req.auth.role === 'student' ? await HomeworkSubmission.findOne({ homeworkId: h._id, studentId: student._id }).lean() : null;
            items.push({ type: 'homework', at: new Date(h.createdAt).toISOString(), title: `Homework: ${h.title}`, detail: `Due ${new Date(h.dueAt).toISOString().slice(0, 10)}${sub ? `; submitted${sub.grade ? `, grade ${sub.grade}` : ''}` : ''}` });
        }
    if (wanted.has('exams') && features.includes('exams'))
        for (const exam of await Exam.find({ status: 'published', endsOn: { $gte: since } }).sort({ endsOn: -1 }).limit(50).lean())
            for (const subject of exam.subjects || []) {
                const r = (subject.results || []).find((x) => x.published && String(x.studentId) === String(student._id));
                if (r)
                    items.push({ type: 'exams', at: new Date(exam.endsOn).toISOString(), title: `${exam.name}: ${subject.name} ${r.marks}/${subject.maxMarks}`, detail: r.grade ? `Grade ${r.grade}` : undefined });
            }
    if (wanted.has('notifications'))
        for (const n of await Notification.find({ recipientId: id(req.auth.sub), createdAt: { $gte: since }, 'metadata.studentId': String(student._id) }).sort({ createdAt: -1 }).limit(200).lean())
            items.push({ type: 'notifications', at: new Date(n.createdAt).toISOString(), title: n.message });
    items.sort((a, b) => b.at.localeCompare(a.at));
    res.json({ student: { id: student._id, name: student.name, admissionNo: student.admissionNo }, days, sectionsIncluded: ['attendance', 'fees', 'homework', 'exams', 'notifications'].filter(t => wanted.has(t) && (t === 'notifications' || features.includes(t))), items: items.slice(0, 500) });
}));
