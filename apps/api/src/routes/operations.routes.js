import { Router } from 'express';
import mongoose from 'mongoose';
import { inTransaction } from '../db.js';
import { z } from 'zod';
import { AcademicYear, AdmissionApplication, AdmissionInquiry, Classroom, Exam, FeeCharge, FeeHead, FeePayment, InquiryMessage, LibraryBook, LibraryLoan, Membership, Notification, PayrollRun, SchoolMessage, SchoolSupportTicket, SchoolSupportMessage, StaffAttendance, StaffLeave, Student, StudentPromotion, StudentTransport, TimetableEntry, TransportRoute, TransportVehicle, VehicleLocation } from '../models.js';
import { asyncRoute, audit, id, paginatedLimit, validId } from '../helpers.js';
import { authenticate, requireFeature, requirePermission, requireRoles } from '../middleware/auth.js';
export const operationsRouter = Router();
operationsRouter.use(authenticate);
const canSeeStudent = async (req, studentId) => {
    const student = await Student.findById(studentId).select('userId guardianIds classId').lean();
    if (!student)
        return false;
    if (req.auth.role === 'parent')
        return student.guardianIds.some((u) => String(u) === req.auth.sub);
    if (req.auth.role === 'student')
        return String(student.userId) === req.auth.sub;
    if (req.auth.role === 'teacher')
        return !!await (await import('../models.js')).TeacherAssignment.exists({ teacherId: id(req.auth.sub), classId: student.classId });
    return true;
};
// Admission staff workflows. Admission is one transaction: student record and guardian membership commit together.
operationsRouter.get('/admissions/inquiries', requireFeature('admissions_inquiries'), requirePermission('admissions.manage'), asyncRoute(async (req, res) => res.json(await AdmissionInquiry.find({ ...(typeof req.query.status === 'string' ? { status: req.query.status } : {}) }).sort({ createdAt: -1 }).limit(paginatedLimit(req.query.limit)).lean())));
operationsRouter.patch('/admissions/inquiries/:inquiryId', requireFeature('admissions_inquiries'), requirePermission('admissions.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.inquiryId))
        return res.status(400).json({ message: 'Invalid inquiry id' });
    const body = z.object({ status: z.enum(['new', 'contacted', 'under_review', 'closed']) }).parse(req.body);
    const inquiry = await AdmissionInquiry.findByIdAndUpdate(req.params.inquiryId, { $set: { status: body.status } }, { new: true });
    if (!inquiry)
        return res.status(404).json({ message: 'Inquiry not found' });
    await audit(req, 'admission.inquiry_updated', 'inquiry', inquiry._id, { status: body.status });
    res.json(inquiry);
}));
operationsRouter.get('/admissions/inquiries/:inquiryId/messages', requireFeature('admissions_inquiries'), requirePermission('admissions.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.inquiryId) || !await AdmissionInquiry.exists({ _id: req.params.inquiryId }))
        return res.status(404).json({ message: 'Inquiry not found' });
    res.json(await InquiryMessage.find({ inquiryId: id(req.params.inquiryId) }).sort({ createdAt: 1 }).lean());
}));
operationsRouter.post('/admissions/inquiries/:inquiryId/messages', requireFeature('admissions_inquiries'), requirePermission('admissions.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.inquiryId))
        return res.status(400).json({ message: 'Invalid inquiry id' });
    const body = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
    const inquiry = await AdmissionInquiry.findById(req.params.inquiryId).lean();
    if (!inquiry)
        return res.status(404).json({ message: 'Inquiry not found' });
    const msg = await InquiryMessage.create({ inquiryId: inquiry._id, senderUserId: id(req.auth.sub), senderType: 'staff', body: body.body });
    await audit(req, 'admission.inquiry_replied', 'inquiry', inquiry._id);
    await Notification.create({ recipientId: inquiry.applicantUserId, type: 'admission_reply', message: 'The school replied to your admission inquiry.', metadata: { inquiryId: String(inquiry._id) } });
    res.status(201).json(msg);
}));
operationsRouter.get('/admissions/applications', requireFeature('admissions'), requirePermission('admissions.manage'), asyncRoute(async (req, res) => res.json(await AdmissionApplication.find({ ...(typeof req.query.status === 'string' ? { status: req.query.status } : {}) }).sort({ createdAt: -1 }).limit(paginatedLimit(req.query.limit)).lean())));
operationsRouter.patch('/admissions/applications/:applicationId', requireFeature('admissions'), requirePermission('admissions.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.applicationId))
        return res.status(400).json({ message: 'Invalid application id' });
    const body = z.object({ status: z.enum(['under_review', 'accepted', 'rejected']), decisionNote: z.string().max(2000).optional() }).parse(req.body);
    const app = await AdmissionApplication.findOneAndUpdate({ _id: req.params.applicationId, status: { $in: ['submitted', 'under_review'] } }, { $set: body }, { new: true });
    if (!app)
        return res.status(404).json({ message: 'Application not found or already decided' });
    await audit(req, 'admission.application_decided', 'application', app._id, { status: body.status });
    res.json(app);
}));
operationsRouter.post('/admissions/applications/:applicationId/admit', requireFeature('admissions'), requirePermission('admissions.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.applicationId))
        return res.status(400).json({ message: 'Invalid application id' });
    const body = z.object({ classId: z.string(), admissionNo: z.string().trim().min(1).max(80), academicYearId: z.string().optional() }).parse(req.body);
    if (!validId(body.classId) || body.academicYearId && !validId(body.academicYearId))
        return res.status(400).json({ message: 'Class or academic year is invalid' });
    const application = await AdmissionApplication.findOne({ _id: req.params.applicationId, status: 'accepted' });
    if (!application)
        return res.status(404).json({ message: 'Accepted application not found' });
    const classroom = await Classroom.findById(body.classId).lean();
    if (!classroom)
        return res.status(400).json({ message: 'Class is not in this school' });
    const academicYearId = body.academicYearId ? id(body.academicYearId) : classroom.academicYearId;
    if (!academicYearId || !await AcademicYear.exists({ _id: academicYearId }))
        return res.status(400).json({ message: 'A valid academic year is required' });
    let student;
    await inTransaction(async (session) => {
        student = (await Student.create([{ name: application.studentName, admissionNo: body.admissionNo, dateOfBirth: application.dateOfBirth || undefined, classId: classroom._id, academicYearId, guardianIds: [application.applicantUserId], status: 'active' }], { session }))[0];
        await Membership.updateOne({ userId: application.applicantUserId, role: 'parent' }, { $setOnInsert: { userId: application.applicantUserId, role: 'parent', status: 'active', smsConsent: false } }, { upsert: true, session });
        application.status = 'admitted';
        application.admittedStudentId = student._id;
        await application.save({ session });
    });
    await audit(req, 'admission.student_admitted', 'student', student._id, { applicationId: String(application._id), academicYearId: String(academicYearId) });
    res.status(201).json({ student, guardianUserId: application.applicantUserId, guardianMembershipCreated: true });
}));
// Fees and receipts. Online gateway order creation is intentionally a distinct integration boundary.
operationsRouter.get('/fees/heads', requireFeature('fees'), requirePermission('fees.view'), asyncRoute(async (_req, res) => res.json(await FeeHead.find({ active: true }).sort({ name: 1 }).lean())));
operationsRouter.post('/fees/heads', requireFeature('fees'), requirePermission('fees.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(120), amountPaise: z.number().int().positive(), academicYearId: z.string() }).parse(req.body);
    if (!validId(body.academicYearId) || !await AcademicYear.exists({ _id: body.academicYearId }))
        return res.status(400).json({ message: 'Academic year is invalid' });
    const head = await FeeHead.create({ ...body, academicYearId: id(body.academicYearId), active: true });
    await audit(req, 'fee.head_created', 'fee_head', head._id, { name: body.name, amountPaise: body.amountPaise });
    res.status(201).json(head);
}));
operationsRouter.post('/fees/charges', requireFeature('fees'), requirePermission('fees.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ studentId: z.string(), headId: z.string(), label: z.string().trim().min(1).max(160), amountPaise: z.number().int().nonnegative(), discountPaise: z.number().int().nonnegative().default(0), finePaise: z.number().int().nonnegative().default(0), dueDate: z.string().date() }).parse(req.body);
    if (!validId(body.studentId) || !validId(body.headId) || !await Student.exists({ _id: body.studentId }) || !await FeeHead.exists({ _id: body.headId, active: true }))
        return res.status(400).json({ message: 'Student or fee head is invalid' });
    const head = await FeeHead.findById(body.headId).lean();
    const charge = await FeeCharge.create({ ...body, studentId: id(body.studentId), headId: id(body.headId), academicYearId: head.academicYearId, paidPaise: 0, status: 'due' });
    await audit(req, 'fee.charge_created', 'fee_charge', charge._id, { studentId: body.studentId, amountPaise: body.amountPaise });
    res.status(201).json(charge);
}));
operationsRouter.get('/fees/students/:studentId', requireFeature('fees'), requirePermission('fees.view'), asyncRoute(async (req, res) => {
    if (!validId(req.params.studentId) || !await canSeeStudent(req, req.params.studentId))
        return res.status(404).json({ message: 'Student not found' });
    res.json(await FeeCharge.find({ studentId: id(req.params.studentId) }).sort({ dueDate: 1 }).lean());
}));
operationsRouter.post('/fees/charges/:chargeId/manual-payment', requireFeature('fees'), requirePermission('fees.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.chargeId))
        return res.status(400).json({ message: 'Invalid charge id' });
    const body = z.object({ amountPaise: z.number().int().positive(), method: z.enum(['cash', 'bank_transfer', 'cheque', 'other']), reference: z.string().max(120).optional() }).parse(req.body);
    let payment;
    await inTransaction(async (session) => {
        const charge = await FeeCharge.findById(req.params.chargeId).session(session ?? null);
        if (!charge)
            throw Object.assign(new Error('Charge not found'), { statusCode: 404 });
        const outstanding = Math.max(0, (charge.amountPaise || 0) + (charge.finePaise || 0) - (charge.discountPaise || 0) - (charge.paidPaise || 0));
        if (body.amountPaise > outstanding)
            throw Object.assign(new Error('Payment exceeds the outstanding amount'), { statusCode: 400 });
        charge.paidPaise = (charge.paidPaise || 0) + body.amountPaise;
        charge.status = charge.paidPaise >= (charge.amountPaise || 0) + (charge.finePaise || 0) - (charge.discountPaise || 0) ? 'paid' : 'partial';
        await charge.save({ session });
        payment = (await FeePayment.create([{ studentId: charge.studentId, amountPaise: body.amountPaise, method: body.method, status: 'paid', receiptNo: `R-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`, allocations: [{ chargeId: charge._id, amountPaise: body.amountPaise }], paidAt: new Date(), requestKey: body.reference || new mongoose.Types.ObjectId().toString() }], { session }))[0];
    });
    await audit(req, 'fee.payment_recorded', 'fee_payment', payment._id, { amountPaise: body.amountPaise });
    res.status(201).json(payment);
}));
operationsRouter.post('/fees/charges/:chargeId/payment-order', requireFeature('fees'), requireFeature('online_payment'), requirePermission('fees.view'), asyncRoute(async (req, res) => {
    if (!['owner', 'principal', 'accountant', 'parent', 'student'].includes(req.auth.role || ''))
        return res.status(403).json({ message: 'This role cannot start a fee payment' });
    if (!validId(req.params.chargeId))
        return res.status(400).json({ message: 'Invalid fee charge id' });
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
        return res.status(503).json({ message: 'Razorpay is not configured' });
    const key = String(req.headers['idempotency-key'] || '');
    if (key.length < 8 || key.length > 120)
        return res.status(400).json({ message: 'Send a unique Idempotency-Key header' });
    const prior = await FeePayment.findOne({ requestKey: key }).lean();
    if (prior?.providerOrderId)
        return res.json({ orderId: prior.providerOrderId, amountPaise: prior.amountPaise, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, paymentId: prior._id });
    const charge = await FeeCharge.findById(req.params.chargeId).lean();
    if (!charge || !await canSeeStudent(req, String(charge.studentId)))
        return res.status(404).json({ message: 'Fee charge not found' });
    const amount = Math.max(0, (charge.amountPaise || 0) + (charge.finePaise || 0) - (charge.discountPaise || 0) - (charge.paidPaise || 0));
    if (!amount)
        return res.status(400).json({ message: 'This charge has no outstanding balance' });
    let payment = prior ? await FeePayment.findById(prior._id) : null;
    if (payment) {
        payment.status = 'creating';
        payment.amountPaise = amount;
        payment.allocations = [{ chargeId: charge._id, amountPaise: amount }];
        await payment.save();
    }
    else
        payment = await FeePayment.create({ studentId: charge.studentId, requestKey: key, amountPaise: amount, method: 'razorpay', status: 'creating', allocations: [{ chargeId: charge._id, amountPaise: amount }] });
    try {
        const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
        const response = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' }, body: JSON.stringify({ amount, currency: 'INR', receipt: `fee-${payment._id}`, notes: { schoolId: req.auth.schoolId, feePaymentId: String(payment._id) } }), signal: AbortSignal.timeout(10000) });
        const order = await response.json().catch(() => ({}));
        if (!response.ok)
            throw Object.assign(new Error(order.error?.description || 'Razorpay order creation failed'), { statusCode: 502 });
        payment.providerOrderId = order.id;
        payment.status = 'created';
        await payment.save();
        res.status(201).json({ orderId: order.id, amountPaise: amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, paymentId: payment._id });
    }
    catch (error) {
        payment.status = 'failed';
        await payment.save();
        throw error;
    }
}));
// Payroll is prepared by accounting staff and approved only by the school owner.
operationsRouter.get('/payroll', requireFeature('payroll'), requirePermission('payroll.view'), asyncRoute(async (_req, res) => res.json(await PayrollRun.find({}).sort({ month: -1 }).limit(36).lean())));
operationsRouter.post('/payroll', requireFeature('payroll'), requirePermission('payroll.prepare'), asyncRoute(async (req, res) => {
    const body = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), items: z.array(z.object({ staffUserId: z.string(), grossPaise: z.number().int().nonnegative(), deductionsPaise: z.number().int().nonnegative() })).min(1).max(500) }).parse(req.body);
    if (body.items.some(x => !validId(x.staffUserId) || x.deductionsPaise > x.grossPaise))
        return res.status(400).json({ message: 'Payroll item contains invalid staff or deductions' });
    for (const item of body.items)
        if (!await Membership.exists({ userId: id(item.staffUserId), status: 'active', role: { $in: ['teacher', 'principal', 'admission_staff', 'accountant', 'librarian', 'bus_driver'] } }))
            return res.status(400).json({ message: 'Payroll can only include active staff members of this school' });
    const run = await PayrollRun.create({ month: body.month, items: body.items.map(x => ({ ...x, netPaise: x.grossPaise - x.deductionsPaise, staffUserId: id(x.staffUserId) })), preparedBy: id(req.auth.sub), status: 'pending_approval' });
    await audit(req, 'payroll.prepared', 'payroll', run._id, { month: body.month });
    res.status(201).json(run);
}));
operationsRouter.post('/payroll/:runId/approve', requireFeature('payroll'), requireRoles('owner'), asyncRoute(async (req, res) => {
    if (!validId(req.params.runId))
        return res.status(400).json({ message: 'Invalid payroll run id' });
    const body = z.object({ approvalNote: z.string().max(1000).optional() }).parse(req.body);
    const run = await PayrollRun.findOneAndUpdate({ _id: req.params.runId, status: 'pending_approval' }, { $set: { status: 'approved', approvedBy: id(req.auth.sub), approvalNote: body.approvalNote || '' } }, { new: true });
    if (!run)
        return res.status(404).json({ message: 'Pending payroll run not found' });
    await audit(req, 'payroll.approved', 'payroll', run._id);
    res.json(run);
}));
// Library stock and loans.
operationsRouter.get('/library/books', requireFeature('library'), requirePermission('library.view'), asyncRoute(async (_req, res) => res.json(await LibraryBook.find({ active: true }).sort({ title: 1 }).lean())));
operationsRouter.post('/library/books', requireFeature('library'), requirePermission('library.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ title: z.string().trim().min(1).max(200), author: z.string().max(160).optional(), isbn: z.string().max(32).optional(), shelfCode: z.string().max(80).optional(), totalCopies: z.number().int().positive().max(10000) }).parse(req.body);
    const book = await LibraryBook.create({ ...body, active: true });
    await audit(req, 'library.book_added', 'library_book', book._id, { title: body.title });
    res.status(201).json(book);
}));
operationsRouter.post('/library/loans', requireFeature('library'), requirePermission('library.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ bookId: z.string(), studentId: z.string(), dueDate: z.string().date() }).parse(req.body);
    if (!validId(body.bookId) || !validId(body.studentId) || !await LibraryBook.exists({ _id: body.bookId, active: true }) || !await Student.exists({ _id: body.studentId, status: 'active' }))
        return res.status(400).json({ message: 'Book or student is invalid' });
    const loan = await LibraryLoan.create({ bookId: id(body.bookId), studentId: id(body.studentId), issuedBy: id(req.auth.sub), dueDate: new Date(body.dueDate), status: 'issued' });
    await audit(req, 'library.book_issued', 'library_loan', loan._id, { studentId: body.studentId, bookId: body.bookId });
    res.status(201).json(loan);
}));
operationsRouter.post('/library/loans/:loanId/return', requireFeature('library'), requirePermission('library.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.loanId))
        return res.status(400).json({ message: 'Invalid loan id' });
    const loan = await LibraryLoan.findOneAndUpdate({ _id: req.params.loanId, returnedAt: null }, { $set: { returnedAt: new Date(), status: 'returned' } }, { new: true });
    if (!loan)
        return res.status(404).json({ message: 'Active loan not found' });
    await audit(req, 'library.book_returned', 'library_loan', loan._id);
    res.json(loan);
}));
// Timetable, staff attendance/leave, student progression.
operationsRouter.get('/timetable', requirePermission('timetable.view'), asyncRoute(async (req, res) => {
    const filter = {};
    if (typeof req.query.classId === 'string' && validId(req.query.classId))
        filter.classId = id(req.query.classId);
    if (req.auth.role === 'teacher')
        filter.teacherId = id(req.auth.sub);
    if (['parent', 'student'].includes(req.auth.role || '')) {
        const kids = await Student.find(req.auth.role === 'student' ? { userId: id(req.auth.sub) } : { guardianIds: id(req.auth.sub) }).distinct('classId');
        filter.classId = { $in: kids };
    }
    res.json(await TimetableEntry.find(filter).sort({ weekday: 1, periodNo: 1 }).limit(500).lean());
}));
operationsRouter.get('/exams', requireFeature('exams'), requirePermission('exams.view'), asyncRoute(async (req, res) => {
    const rows = await Exam.find({}).sort({ startsOn: -1 }).limit(100).lean();
    if (['parent', 'student'].includes(req.auth.role || '')) {
        const family = await Student.find(req.auth.role === 'student' ? { userId: id(req.auth.sub) } : { guardianIds: id(req.auth.sub) }).select('_id classId').lean();
        const studentIds = new Set(family.map(s => String(s._id))), classIds = new Set(family.map(s => String(s.classId)));
        return res.json(rows.map((exam) => ({ ...exam, subjects: exam.subjects.filter((subject) => classIds.has(String(subject.classId))).map((subject) => ({ ...subject, results: subject.results.filter((r) => r.published && studentIds.has(String(r.studentId))) })) })));
    }
    if (req.auth.role === 'teacher') {
        const assigned = new Set((await (await import('../models.js')).TeacherAssignment.find({ teacherId: id(req.auth.sub) }).distinct('classId')).map(String));
        return res.json(rows.map((exam) => ({ ...exam, subjects: exam.subjects.filter((subject) => assigned.has(String(subject.classId))) })));
    }
    res.json(rows);
}));
operationsRouter.post('/exams', requireFeature('exams'), requirePermission('exams.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ academicYearId: z.string(), name: z.string().trim().min(2).max(160), startsOn: z.string().date(), endsOn: z.string().date(), subjects: z.array(z.object({ classId: z.string(), name: z.string().trim().min(1).max(120), maxMarks: z.number().positive().max(10000) })).min(1).max(300) }).parse(req.body);
    if (!validId(body.academicYearId) || body.endsOn < body.startsOn || !await AcademicYear.exists({ _id: body.academicYearId }))
        return res.status(400).json({ message: 'Exam dates or academic year are invalid' });
    for (const subject of body.subjects)
        if (!validId(subject.classId) || !await Classroom.exists({ _id: subject.classId, academicYearId: id(body.academicYearId) }))
            return res.status(400).json({ message: 'Every exam subject must refer to a class in this academic year' });
    const created = await Exam.create({ academicYearId: id(body.academicYearId), name: body.name, startsOn: new Date(body.startsOn), endsOn: new Date(body.endsOn), status: 'draft', subjects: body.subjects.map(s => ({ ...s, classId: id(s.classId), results: [] })) });
    await audit(req, 'exam.created', 'exam', created._id, { name: body.name });
    res.status(201).json(created);
}));
operationsRouter.patch('/exams/:examId/results', requireFeature('exams'), requirePermission('exams.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.examId))
        return res.status(400).json({ message: 'Invalid exam id' });
    const body = z.object({ subjectName: z.string().trim().min(1).max(120), results: z.array(z.object({ studentId: z.string(), marks: z.number().nonnegative(), grade: z.string().max(20).optional() })).min(1).max(1000) }).parse(req.body);
    const exam = await Exam.findById(req.params.examId);
    if (!exam)
        return res.status(404).json({ message: 'Exam not found' });
    const subject = exam.subjects.find((s) => s.name === body.subjectName);
    if (!subject)
        return res.status(404).json({ message: 'Exam subject not found' });
    const ids = body.results.map(r => r.studentId);
    if (ids.some(x => !validId(x)) || new Set(ids).size !== ids.length || body.results.some(r => r.marks > subject.maxMarks))
        return res.status(400).json({ message: 'Result student IDs or marks are invalid' });
    const students = await Student.find({ _id: { $in: ids.map(id) }, classId: subject.classId, status: 'active' }).select('_id').lean();
    if (students.length !== ids.length)
        return res.status(400).json({ message: 'Every student must be active in the subject class' });
    for (const result of body.results) {
        const prior = subject.results.find((x) => String(x.studentId) === result.studentId);
        if (prior) {
            prior.marks = result.marks;
            prior.grade = result.grade || '';
        }
        else
            subject.results.push({ studentId: id(result.studentId), marks: result.marks, grade: result.grade || '', published: false });
    }
    await exam.save();
    await audit(req, 'exam.results_entered', 'exam', exam._id, { subject: body.subjectName, count: body.results.length });
    res.json(exam);
}));
operationsRouter.post('/exams/:examId/publish', requireFeature('exams'), requirePermission('exams.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.examId))
        return res.status(400).json({ message: 'Invalid exam id' });
    const exam = await Exam.findById(req.params.examId);
    if (!exam)
        return res.status(404).json({ message: 'Exam not found' });
    for (const subject of exam.subjects)
        for (const result of subject.results)
            result.published = true;
    exam.status = 'published';
    await exam.save();
    await audit(req, 'exam.published', 'exam', exam._id, { name: exam.name });
    res.json({ published: true, exam });
}));
operationsRouter.post('/timetable', requireFeature('students'), requirePermission('timetable.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ academicYearId: z.string(), classId: z.string(), weekday: z.number().int().min(1).max(7), periodNo: z.number().int().min(1).max(20), startsAt: z.string().regex(/^\d{2}:\d{2}$/), endsAt: z.string().regex(/^\d{2}:\d{2}$/), subject: z.string().trim().min(1).max(120), teacherId: z.string(), room: z.string().max(80).optional() }).parse(req.body);
    if (![body.academicYearId, body.classId, body.teacherId].every(validId) || !await AcademicYear.exists({ _id: body.academicYearId }) || !await Classroom.exists({ _id: body.classId, academicYearId: id(body.academicYearId) }) || !await Membership.exists({ userId: id(body.teacherId), role: 'teacher', status: 'active' }))
        return res.status(400).json({ message: 'Academic year, class or teacher is invalid' });
    const entry = await TimetableEntry.create({ ...body, academicYearId: id(body.academicYearId), classId: id(body.classId), teacherId: id(body.teacherId) });
    await audit(req, 'timetable.entry_created', 'timetable', entry._id, { classId: body.classId, subject: body.subject });
    res.status(201).json(entry);
}));
operationsRouter.post('/staff/attendance/:date', requirePermission('staff.attendance.manage'), asyncRoute(async (req, res) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date) || Number.isNaN(Date.parse(`${req.params.date}T00:00:00Z`)))
        return res.status(400).json({ message: 'Invalid date' });
    const body = z.object({ records: z.array(z.object({ userId: z.string(), status: z.enum(['present', 'absent', 'late', 'leave']), note: z.string().max(500).optional() })).min(1).max(500) }).parse(req.body);
    const ids = body.records.map(x => x.userId);
    if (ids.some(x => !validId(x)) || new Set(ids).size !== ids.length)
        return res.status(400).json({ message: 'Staff ids must be valid and unique' });
    const staff = await Membership.find({ userId: { $in: ids.map(id) }, role: { $in: ['teacher', 'principal', 'admission_staff', 'accountant', 'librarian', 'bus_driver'] }, status: 'active' }).distinct('userId');
    if (staff.length !== ids.length)
        return res.status(400).json({ message: 'A selected staff member is not active in this school' });
    const saved = [];
    for (const item of body.records)
        saved.push(await StaffAttendance.findOneAndUpdate({ userId: id(item.userId), date: req.params.date }, { $set: { status: item.status, note: item.note || '', markedBy: id(req.auth.sub) } }, { upsert: true, new: true, setDefaultsOnInsert: true }));
    await audit(req, 'staff.attendance_marked', 'staff_attendance', req.params.date, { count: saved.length });
    res.json({ date: req.params.date, records: saved });
}));
operationsRouter.post('/staff/leaves', requirePermission('staff.leave.request'), asyncRoute(async (req, res) => {
    const body = z.object({ startDate: z.string().date(), endDate: z.string().date(), reason: z.string().trim().min(5).max(2000) }).parse(req.body);
    if (body.endDate < body.startDate)
        return res.status(400).json({ message: 'Leave end date must not precede start date' });
    const leave = await StaffLeave.create({ userId: id(req.auth.sub), startDate: new Date(body.startDate), endDate: new Date(body.endDate), reason: body.reason, status: 'pending' });
    res.status(201).json(leave);
}));
operationsRouter.get('/staff/leaves', requirePermission('staff.leave.manage'), asyncRoute(async (_req, res) => res.json(await StaffLeave.find({ status: 'pending' }).sort({ createdAt: 1 }).limit(300).lean())));
operationsRouter.patch('/staff/leaves/:leaveId', requirePermission('staff.leave.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.leaveId))
        return res.status(400).json({ message: 'Invalid leave id' });
    const body = z.object({ status: z.enum(['approved', 'rejected']) }).parse(req.body);
    const row = await StaffLeave.findOneAndUpdate({ _id: req.params.leaveId, status: 'pending' }, { $set: { status: body.status, approvedBy: id(req.auth.sub) } }, { new: true });
    if (!row)
        return res.status(404).json({ message: 'Pending leave not found' });
    await audit(req, 'staff.leave_decided', 'staff_leave', row._id, { status: body.status });
    res.json(row);
}));
operationsRouter.post('/students/:studentId/promote', requireFeature('students'), requirePermission('promotion.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.studentId))
        return res.status(400).json({ message: 'Invalid student id' });
    const body = z.object({ toClassId: z.string(), toAcademicYearId: z.string() }).parse(req.body);
    if (!validId(body.toClassId) || !validId(body.toAcademicYearId))
        return res.status(400).json({ message: 'Target class or year is invalid' });
    const student = await Student.findById(req.params.studentId);
    if (!student)
        return res.status(404).json({ message: 'Student not found' });
    const target = await Classroom.findOne({ _id: body.toClassId, academicYearId: id(body.toAcademicYearId) }).lean();
    if (!target || !await AcademicYear.exists({ _id: body.toAcademicYearId }))
        return res.status(400).json({ message: 'Target class and academic year must exist in this school' });
    const previous = { fromClassId: student.classId, fromAcademicYearId: student.academicYearId };
    student.classId = id(body.toClassId);
    student.academicYearId = id(body.toAcademicYearId);
    await student.save();
    const row = await StudentPromotion.create({ studentId: student._id, ...previous, toClassId: student.classId, toAcademicYearId: student.academicYearId, promotedBy: id(req.auth.sub), promotedAt: new Date() });
    await audit(req, 'student.promoted', 'student', student._id, { toClassId: body.toClassId, toAcademicYearId: body.toAcademicYearId });
    res.json({ student, promotion: row });
}));
operationsRouter.post('/transport/vehicles', requireFeature('transport'), requirePermission('transport.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(1).max(100), registrationNo: z.string().trim().min(3).max(30), capacity: z.number().int().positive().max(200), driverUserId: z.string() }).parse(req.body);
    if (!validId(body.driverUserId) || !await Membership.exists({ userId: id(body.driverUserId), role: 'bus_driver', status: 'active' }))
        return res.status(400).json({ message: 'Driver must have an active driver membership in this school' });
    res.status(201).json(await TransportVehicle.create({ name: body.name, registrationNo: body.registrationNo, capacity: body.capacity, driverId: id(body.driverUserId), active: true }));
}));
operationsRouter.post('/transport/routes', requireFeature('transport'), requirePermission('transport.manage'), asyncRoute(async (req, res) => {
    const body = z.object({ academicYearId: z.string(), vehicleId: z.string(), name: z.string().trim().min(1).max(120), stops: z.array(z.object({ name: z.string().trim().min(1).max(160), order: z.number().int().nonnegative(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), pickupTime: z.string().regex(/^\d{2}:\d{2}$/) })).min(1).max(100) }).parse(req.body);
    if (!validId(body.academicYearId) || !validId(body.vehicleId) || !await AcademicYear.exists({ _id: body.academicYearId }) || !await TransportVehicle.exists({ _id: body.vehicleId, active: true }))
        return res.status(400).json({ message: 'Academic year or vehicle is invalid' });
    res.status(201).json(await TransportRoute.create({ academicYearId: id(body.academicYearId), vehicleId: id(body.vehicleId), name: body.name, stops: body.stops, active: true }));
}));
operationsRouter.post('/transport/students/:studentId/assign', requireFeature('transport'), requirePermission('transport.manage'), asyncRoute(async (req, res) => {
    if (!validId(req.params.studentId))
        return res.status(400).json({ message: 'Invalid student id' });
    const body = z.object({ routeId: z.string(), stopId: z.string() }).parse(req.body);
    if (!validId(body.routeId))
        return res.status(400).json({ message: 'Invalid route' });
    const route = await TransportRoute.findOne({ _id: body.routeId, active: true }).lean();
    if (!route || !await Student.exists({ _id: req.params.studentId, status: 'active' }) || !route.stops.some((s) => String(s._id) === body.stopId))
        return res.status(400).json({ message: 'Student, route or stop is invalid' });
    res.status(201).json(await StudentTransport.findOneAndUpdate({ studentId: id(req.params.studentId) }, { $set: { studentId: id(req.params.studentId), routeId: id(body.routeId), stopId: id(body.stopId), academicYearId: route.academicYearId } }, { upsert: true, new: true, setDefaultsOnInsert: true }));
}));
operationsRouter.post('/transport/vehicles/:vehicleId/location', requireFeature('live_gps'), requireRoles('bus_driver'), requirePermission('transport.location.push'), asyncRoute(async (req, res) => {
    if (!validId(req.params.vehicleId))
        return res.status(400).json({ message: 'Invalid vehicle id' });
    const body = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(10000).optional(), capturedAt: z.string().datetime() }).parse(req.body);
    if (new Date(body.capturedAt).getTime() > Date.now() + 60_000 || Date.now() - new Date(body.capturedAt).getTime() > 10 * 60_000)
        return res.status(400).json({ message: 'Location sample must be no older than ten minutes and not in the future' });
    if (!await TransportVehicle.exists({ _id: req.params.vehicleId, driverId: id(req.auth.sub), active: true }))
        return res.status(404).json({ message: 'Vehicle is not assigned to this driver' });
    res.status(201).json(await VehicleLocation.create({ vehicleId: id(req.params.vehicleId), driverId: id(req.auth.sub), latitude: body.latitude, longitude: body.longitude, accuracyM: body.accuracyM || 0, capturedAt: new Date(body.capturedAt) }));
}));
operationsRouter.get('/transport/students/:studentId/location', requireFeature('live_gps'), requirePermission('transport.view'), asyncRoute(async (req, res) => {
    if (!validId(req.params.studentId) || !await canSeeStudent(req, req.params.studentId))
        return res.status(404).json({ message: 'Student not found' });
    const assignment = await StudentTransport.findOne({ studentId: id(req.params.studentId) }).lean();
    if (!assignment)
        return res.status(404).json({ message: 'Student has no bus assignment' });
    const route = await TransportRoute.findById(assignment.routeId).select('name vehicleId stops').lean();
    if (!route)
        return res.status(404).json({ message: 'Route not found' });
    const location = await VehicleLocation.findOne({ vehicleId: route.vehicleId }).sort({ capturedAt: -1 }).lean();
    res.json({ route: route.name, stop: route.stops.find((s) => String(s._id) === String(assignment.stopId)) || null, location });
}));
// Parent/teacher messaging, with relationship scoping and moderation controls.
operationsRouter.get('/messages', requireFeature('messages'), requirePermission('messages.use'), asyncRoute(async (req, res) => {
    const filter = {};
    if (req.auth.role === 'parent')
        filter.parentId = id(req.auth.sub);
    else if (req.auth.role === 'teacher')
        filter.teacherId = id(req.auth.sub);
    else if (req.auth.role === 'student')
        return res.status(403).json({ message: 'Student messaging is not enabled' });
    res.json(await SchoolMessage.find(filter).sort({ createdAt: -1 }).limit(paginatedLimit(req.query.limit)).lean());
}));
operationsRouter.post('/messages', requireFeature('messages'), requirePermission('messages.use'), asyncRoute(async (req, res) => {
    const body = z.object({ studentId: z.string(), body: z.string().trim().min(1).max(3000) }).parse(req.body);
    if (!validId(body.studentId) || !await canSeeStudent(req, body.studentId))
        return res.status(404).json({ message: 'Student not found or not linked to your account' });
    const student = await Student.findById(body.studentId).lean();
    if (!student)
        return res.status(404).json({ message: 'Student not found' });
    const teacherId = req.auth.role === 'teacher' ? req.auth.sub : String((await (await import('../models.js')).TeacherAssignment.findOne({ classId: student.classId }).select('teacherId').lean())?.teacherId || '');
    const parentId = req.auth.role === 'parent' ? req.auth.sub : String(student.guardianIds[0] || '');
    if (!validId(teacherId) || !validId(parentId))
        return res.status(400).json({ message: 'The student needs an assigned teacher and linked parent account' });
    const message = await SchoolMessage.create({ studentId: id(body.studentId), teacherId: id(teacherId), parentId: id(parentId), senderId: id(req.auth.sub), body: body.body, moderationStatus: 'visible' });
    res.status(201).json(message);
}));
// Help desk and basic notifications.
operationsRouter.get('/notifications', asyncRoute(async (req, res) => res.json(await Notification.find({ recipientId: id(req.auth.sub) }).sort({ createdAt: -1 }).limit(100).lean())));
operationsRouter.post('/support', requirePermission('support.create'), asyncRoute(async (req, res) => { const body = z.object({ subject: z.string().trim().min(3).max(160), body: z.string().trim().min(10).max(4000) }).parse(req.body); res.status(201).json(await SchoolSupportTicket.create({ createdBy: id(req.auth.sub), subject: body.subject, body: body.body, status: 'open', priority: 'normal' })); }));
operationsRouter.get('/support', requireRoles('owner', 'principal'), asyncRoute(async (_req, res) => res.json(await SchoolSupportTicket.find({}).sort({ createdAt: -1 }).limit(200).lean())));
operationsRouter.patch('/support/:ticketId', requireRoles('owner', 'principal'), asyncRoute(async (req, res) => { if (!validId(req.params.ticketId))
    return res.status(400).json({ message: 'Invalid ticket id' }); const body = z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']), priority: z.enum(['low', 'normal', 'high']).optional() }).parse(req.body); const ticket = await SchoolSupportTicket.findByIdAndUpdate(req.params.ticketId, { $set: body }, { new: true }); if (!ticket)
    return res.status(404).json({ message: 'Ticket not found' }); res.json(ticket); }));

operationsRouter.get('/support/:ticketId/messages', requireRoles('owner', 'principal'), asyncRoute(async (req, res) => {
    if (!validId(req.params.ticketId)) return res.status(400).json({ message: 'Invalid ticket id' });
    if (!await SchoolSupportTicket.exists({ _id: req.params.ticketId })) return res.status(404).json({ message: 'Ticket not found' });
    res.json(await SchoolSupportMessage.find({ ticketId: req.params.ticketId }).sort({ createdAt: 1 }).lean());
}));
operationsRouter.post('/support/:ticketId/messages', requireRoles('owner', 'principal'), asyncRoute(async (req, res) => {
    if (!validId(req.params.ticketId)) return res.status(400).json({ message: 'Invalid ticket id' });
    const body = z.object({ body: z.string().trim().min(1).max(4000) }).parse(req.body);
    const ticket = await SchoolSupportTicket.findById(req.params.ticketId);
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    const message = await SchoolSupportMessage.create({ ticketId: ticket._id, senderId: id(req.auth.sub), senderRole: req.auth.role, body: body.body });
    if (ticket.status === 'open') { ticket.status = 'in_progress'; await ticket.save(); }
    await audit(req, 'support.message_sent', 'support_ticket', ticket._id, { messageId: String(message._id) });
    res.status(201).json(message);
}));
