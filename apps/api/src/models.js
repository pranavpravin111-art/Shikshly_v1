import mongoose, { Schema, Types } from 'mongoose';
import { tenantPlugin } from './tenant-scope.js';
const { ObjectId, Mixed } = Schema.Types;
const opts = { timestamps: true, versionKey: false };
/** Every model whose rows belong to one school. Used by seed/cleanup scripts. */
export const tenantModels = [];
function tenantModel(name, schema) {
    schema.add({ schoolId: { type: ObjectId, required: true, index: true } });
    schema.plugin(tenantPlugin);
    const model = mongoose.models[name] || mongoose.model(name, schema);
    tenantModels.push(model);
    return model;
}
function globalModel(name, schema) {
    return mongoose.models[name] || mongoose.model(name, schema);
}
export const UserPreference = globalModel('UserPreference', new Schema({ userId: { type: ObjectId, required: true, unique: true, index: true }, theme: { type: String, enum: ['system', 'light', 'dark'], default: 'system' }, language: { type: String, enum: ['en', 'hi'], default: 'en' }, emailNotifications: { type: Boolean, default: true }, smsNotifications: { type: Boolean, default: true }, productUpdates: { type: Boolean, default: true } }, opts));
export const User = globalModel('User', new Schema({
    name: { type: String, required: true, trim: true, maxlength: 160 }, email: { type: String, required: true, lowercase: true, unique: true, index: true },
    phone: { type: String, default: '' }, passwordHash: { type: String, required: true }, status: { type: String, enum: ['active', 'disabled'], default: 'active' },
    // Set when the person proves they own the email (verification link or completed password reset).
    emailVerifiedAt: { type: Date, default: null },
}, opts));
export const School = globalModel('School', new Schema({
    name: { type: String, required: true, trim: true }, slug: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['active', 'suspended', 'closed'], default: 'active' },
}, opts));
export const Plan = globalModel('Plan', new Schema({
    key: { type: String, enum: ['free', 'basic', 'standard', 'premium'], unique: true }, name: String,
    description: String, monthlyPaise: { type: Number, default: null }, annualPaise: { type: Number, default: null }, pricePerStudentPaise: { type: Number, min: 0, default: null }, minimumMonthlyPaise: { type: Number, min: 0, default: null }, trialDays: { type: Number, min: 0, default: 30 },
    features: { type: [String], default: [] }, limits: { type: Mixed, default: {} }, available: { type: Boolean, default: true },
}, opts));
export const PlatformAdmin = globalModel('PlatformAdmin', new Schema({ userId: { type: ObjectId, required: true, unique: true }, singleton: { type: Boolean, default: true, unique: true }, status: { type: String, default: 'active' } }, opts));
/** What the super admin did to the platform (plan changes, suspending a school...). Append-only: no route edits or deletes it. */
export const PlatformAuditLog = globalModel('PlatformAuditLog', new Schema({
    actorId: { type: ObjectId, required: true }, action: { type: String, required: true }, targetSchoolId: { type: ObjectId, default: null },
    entity: String, entityId: String, meta: Mixed,
}, opts).index({ createdAt: -1 }).index({ targetSchoolId: 1, createdAt: -1 }));
export const Session = globalModel('Session', new Schema({
    userId: { type: ObjectId, required: true, index: true }, schoolId: { type: ObjectId, default: null }, role: String,
    tokenType: { type: String, enum: ['member', 'applicant', 'platform_admin'], required: true }, device: String, ipHash: String,
    userAgent: String, expiresAt: { type: Date, required: true }, revokedAt: { type: Date, default: null },
}, opts).index({ expiresAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }));
export const Membership = tenantModel('Membership', new Schema({
    userId: { type: ObjectId, required: true }, role: { type: String, enum: ['owner', 'principal', 'admission_staff', 'accountant', 'teacher', 'librarian', 'bus_driver', 'parent', 'student'], required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' }, smsConsent: { type: Boolean, default: false },
}, opts).index({ schoolId: 1, userId: 1 }, { unique: true }));
export const Subscription = tenantModel('Subscription', new Schema({
    planKey: { type: String, enum: ['free', 'basic', 'standard', 'premium'], default: 'free' },
    status: { type: String, enum: ['active', 'trial', 'past_due', 'cancelled', 'expired'], default: 'active' },
    billingPeriod: { type: String, enum: ['monthly', 'annual'], default: 'monthly' }, periodStart: { type: Date, default: null }, periodEnd: { type: Date, default: null },
    trialStart: { type: Date, default: null }, trialEnd: { type: Date, default: null },
    billableStudentCount: { type: Number, min: 0, default: 0 }, pricePerStudentPaise: { type: Number, min: 0, default: 0 }, minimumMonthlyPaise: { type: Number, min: 0, default: 0 },
    autoRenew: { type: Boolean, default: true }, cancelAtPeriodEnd: { type: Boolean, default: false },
    providerSubscriptionId: { type: String, default: null }, providerCustomerId: { type: String, default: null },
}, opts).index({ schoolId: 1 }, { unique: true }).index({ providerSubscriptionId: 1 }, { sparse: true }));
export const SchoolProfile = tenantModel('SchoolProfile', new Schema({
    publicName: String, area: String, address: String, city: String, state: String, country: { type: String, default: 'India' },
    postalCode: String, latitude: Number, longitude: Number, description: String, phone: String, email: String, website: String,
    timeZone: { type: String, default: 'Asia/Kolkata' }, isPublic: { type: Boolean, default: false },
    photos: { type: [String], default: [] }, facilities: { type: [String], default: [] },
}, opts).index({ schoolId: 1 }, { unique: true }));
export const PublicSchool = globalModel('PublicSchool', new Schema({
    schoolId: { type: ObjectId, required: true, unique: true }, slug: { type: String, required: true, unique: true },
    name: String, area: String, city: String, state: String, country: String, latitude: Number, longitude: Number,
    description: String, phone: String, email: String, website: String, photos: [String], facilities: [String],
    isPublic: { type: Boolean, default: false }, rating: { type: Number, default: 0 }, reviewCount: { type: Number, default: 0 },
}, opts).index({ isPublic: 1, name: 'text', area: 'text', city: 'text' }));
export const AcademicYear = tenantModel('AcademicYear', new Schema({ name: { type: String, required: true }, startDate: Date, endDate: Date, isCurrent: { type: Boolean, default: false } }, opts).index({ schoolId: 1, name: 1 }, { unique: true }));
export const Classroom = tenantModel('Classroom', new Schema({ academicYearId: ObjectId, name: String, section: String, teacherIds: { type: [ObjectId], default: [] } }, opts).index({ schoolId: 1, academicYearId: 1, name: 1, section: 1 }, { unique: true }));
export const Student = tenantModel('Student', new Schema({
    userId: { type: ObjectId, default: null }, name: { type: String, required: true, trim: true, maxlength: 160 }, admissionNo: { type: String, trim: true, maxlength: 80 },
    firstName: { type: String, default: '' }, middleName: { type: String, default: '' }, lastName: { type: String, default: '' },
    dateOfBirth: Date, gender: { type: String, default: '' }, admissionDate: Date,
    classId: { type: ObjectId, default: null }, academicYearId: { type: ObjectId, default: null }, guardianIds: { type: [ObjectId], default: [] },
    guardians: [{ relationship: String, name: String, phone: String, email: String }],
    address: { line1: String, city: String, state: String, postalCode: String },
    previousSchool: { name: String, tcNumber: String }, importBatchId: { type: ObjectId, default: null },
    status: { type: String, enum: ['active', 'transferred', 'graduated', 'inactive'], default: 'active' },
}, opts).index({ schoolId: 1, admissionNo: 1 }, { unique: true, sparse: true }).index({ schoolId: 1, classId: 1, academicYearId: 1, status: 1 }));
export const ImportJob = tenantModel('ImportJob', new Schema({
    fileName: { type: String, required: true }, mode: { type: String, enum: ['create_only', 'update_existing'], default: 'create_only' },
    status: { type: String, enum: ['validating', 'ready', 'ready_with_errors', 'processing', 'completed', 'completed_with_errors', 'failed'], default: 'validating' },
    totalRows: { type: Number, default: 0 }, processedRows: { type: Number, default: 0 }, validRows: { type: Number, default: 0 }, invalidRows: { type: Number, default: 0 }, warningRows: { type: Number, default: 0 },
    createdRows: { type: Number, default: 0 }, updatedRows: { type: Number, default: 0 }, failedRows: { type: Number, default: 0 },
    createdBy: { type: ObjectId, required: true }, updatedBy: ObjectId, startedAt: Date, completedAt: Date,
}, opts).index({ schoolId: 1, createdAt: -1 }));
export const ImportRow = tenantModel('ImportRow', new Schema({
    importJobId: { type: ObjectId, required: true, index: true }, rowNumber: Number, rawData: Mixed, normalizedData: Mixed, status: { type: String, enum: ['valid', 'error', 'imported'], default: 'valid' },
    errors: { type: [String], default: [] }, warnings: { type: [String], default: [] }, targetStudentId: { type: ObjectId, default: null },
}, opts).index({ schoolId: 1, importJobId: 1, rowNumber: 1 }, { unique: true }));
export const Invite = tenantModel('Invite', new Schema({
    role: String, codeHash: { type: String, required: true }, maxUses: { type: Number, default: 1 }, usedCount: { type: Number, default: 0 },
    linkedStudentId: { type: ObjectId, default: null }, expiresAt: Date, status: { type: String, default: 'active' }, createdBy: ObjectId,
}, opts).index({ schoolId: 1, codeHash: 1 }, { unique: true }));
export const TeacherAssignment = tenantModel('TeacherAssignment', new Schema({ teacherId: ObjectId, classId: ObjectId, subject: String }, opts).index({ schoolId: 1, teacherId: 1, classId: 1, subject: 1 }, { unique: true }));
export const Attendance = tenantModel('Attendance', new Schema({
    studentId: ObjectId, classId: ObjectId, date: String, status: { type: String, enum: ['present', 'absent', 'late', 'excused'] }, note: String, markedBy: ObjectId,
}, opts).index({ schoolId: 1, studentId: 1, date: 1 }, { unique: true }));
export const Homework = tenantModel('Homework', new Schema({ classId: ObjectId, teacherId: ObjectId, title: String, instructions: String, dueAt: Date, status: { type: String, default: 'assigned' } }, opts));
export const HomeworkSubmission = tenantModel('HomeworkSubmission', new Schema({ homeworkId: ObjectId, studentId: ObjectId, body: String, submittedAt: Date, grade: String, feedback: String }, opts).index({ schoolId: 1, homeworkId: 1, studentId: 1 }, { unique: true }));
export const AdmissionInquiry = tenantModel('AdmissionInquiry', new Schema({ applicantUserId: ObjectId, name: String, email: String, phone: String, message: String, status: { type: String, default: 'new' } }, opts));
export const InquiryMessage = tenantModel('InquiryMessage', new Schema({ inquiryId: ObjectId, senderUserId: ObjectId, senderType: { type: String, enum: ['applicant', 'staff'] }, body: String }, opts));
export const AdmissionApplication = tenantModel('AdmissionApplication', new Schema({
    applicantUserId: ObjectId, inquiryId: ObjectId, studentName: String, dateOfBirth: Date, requestedGrade: String,
    academicYearId: ObjectId, status: { type: String, enum: ['submitted', 'under_review', 'accepted', 'rejected', 'withdrawn', 'admitted'], default: 'submitted' },
    decisionNote: String, admittedStudentId: ObjectId,
}, opts));
export const ApplicantProfile = globalModel('ApplicantProfile', new Schema({ userId: { type: ObjectId, unique: true }, phone: String }, opts));
export const AuditLog = tenantModel('AuditLog', new Schema({ actorId: ObjectId, role: String, action: String, entity: String, entityId: String, meta: Mixed }, opts));
export const Notification = tenantModel('Notification', new Schema({ recipientId: ObjectId, type: String, message: String, readAt: Date, metadata: Mixed }, opts));
export const SmsUsage = tenantModel('SmsUsage', new Schema({ recipientUserId: ObjectId, maskedPhone: String, category: String, templateId: String, provider: String, providerMessageId: String, units: { type: Number, default: 1 }, status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' }, errorCode: String, sentAt: Date }, opts).index({ schoolId: 1, createdAt: -1 }));
export const FeeHead = tenantModel('FeeHead', new Schema({ academicYearId: ObjectId, name: String, amountPaise: Number, active: Boolean }, opts));
export const FeeCharge = tenantModel('FeeCharge', new Schema({ academicYearId: ObjectId, studentId: ObjectId, headId: ObjectId, label: String, amountPaise: Number, discountPaise: Number, finePaise: Number, dueDate: Date, paidPaise: Number, status: String }, opts));
export const FeePayment = tenantModel('FeePayment', new Schema({ studentId: ObjectId, requestKey: String, providerOrderId: String, providerPaymentId: String, amountPaise: Number, method: String, status: String, receiptNo: String, allocations: [{ chargeId: ObjectId, amountPaise: Number }], paidAt: Date }, opts).index({ schoolId: 1, requestKey: 1 }, { unique: true, sparse: true }));
export const PayrollRun = tenantModel('PayrollRun', new Schema({ academicYearId: ObjectId, month: String, status: String, preparedBy: ObjectId, approvedBy: ObjectId, approvalNote: String, items: [{ staffUserId: ObjectId, grossPaise: Number, deductionsPaise: Number, netPaise: Number }] }, opts));
export const StaffAttendance = tenantModel('StaffAttendance', new Schema({ userId: ObjectId, date: String, status: { type: String, enum: ['present', 'absent', 'late', 'leave'] }, note: String, markedBy: ObjectId }, opts).index({ schoolId: 1, userId: 1, date: 1 }, { unique: true }));
export const StaffLeave = tenantModel('StaffLeave', new Schema({ userId: ObjectId, startDate: Date, endDate: Date, reason: String, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }, approvedBy: ObjectId }, opts));
export const StudentPromotion = tenantModel('StudentPromotion', new Schema({ studentId: ObjectId, fromClassId: ObjectId, toClassId: ObjectId, fromAcademicYearId: ObjectId, toAcademicYearId: ObjectId, promotedBy: ObjectId, promotedAt: Date }, opts));
export const LibraryBook = tenantModel('LibraryBook', new Schema({ title: String, author: String, isbn: String, shelfCode: String, totalCopies: Number, active: Boolean }, opts).index({ schoolId: 1, isbn: 1 }, { unique: true, sparse: true }));
export const LibraryLoan = tenantModel('LibraryLoan', new Schema({ bookId: ObjectId, studentId: ObjectId, issuedBy: ObjectId, dueDate: Date, returnedAt: Date, status: String }, opts));
export const Exam = tenantModel('Exam', new Schema({ academicYearId: ObjectId, name: String, startsOn: Date, endsOn: Date, status: String, subjects: [{ classId: ObjectId, name: String, maxMarks: Number, results: [{ studentId: ObjectId, marks: Number, grade: String, published: Boolean }] }] }, opts));
export const TimetableEntry = tenantModel('TimetableEntry', new Schema({ academicYearId: ObjectId, classId: ObjectId, weekday: Number, periodNo: Number, startsAt: String, endsAt: String, subject: String, teacherId: ObjectId, room: String }, opts));
export const Review = globalModel('Review', new Schema({ schoolId: ObjectId, reviewerId: ObjectId, rating: Number, title: String, body: String, moderationStatus: { type: String, default: 'pending' } }, opts).index({ schoolId: 1, reviewerId: 1 }, { unique: true }));
export const AppReview = globalModel('AppReview', new Schema({ userId: { type: ObjectId, required: true, unique: true, index: true }, rating: { type: Number, required: true, min: 1, max: 5 }, feedback: { type: String, maxlength: 2000, default: '' }, platform: { type: String, enum: ['web', 'android', 'ios', 'unknown'], default: 'unknown' }, appVersion: { type: String, default: '' }, moderationStatus: { type: String, enum: ['pending', 'published', 'hidden'], default: 'published' } }, opts).index({ createdAt: -1 }));
export const SchoolMessage = tenantModel('SchoolMessage', new Schema({ parentId: ObjectId, teacherId: ObjectId, studentId: ObjectId, senderId: ObjectId, body: String, moderationStatus: String, readAt: Date }, opts));
export const SchoolSupportTicket = tenantModel('SchoolSupportTicket', new Schema({ createdBy: ObjectId, subject: String, body: String, status: String, priority: String }, opts));
export const SchoolSupportMessage = tenantModel('SchoolSupportMessage', new Schema({ ticketId: { type: ObjectId, required: true, index: true }, senderId: { type: ObjectId, required: true }, senderRole: String, body: { type: String, required: true, maxlength: 4000 } }, opts).index({ schoolId: 1, ticketId: 1, createdAt: 1 }));
export const StudentTransport = tenantModel('StudentTransport', new Schema({ academicYearId: ObjectId, studentId: ObjectId, routeId: ObjectId, stopId: ObjectId }, opts));
export const TransportVehicle = tenantModel('TransportVehicle', new Schema({ name: String, registrationNo: String, capacity: Number, driverId: ObjectId, active: Boolean }, opts));
export const TransportRoute = tenantModel('TransportRoute', new Schema({ academicYearId: ObjectId, vehicleId: ObjectId, name: String, active: Boolean, stops: [{ name: String, order: Number, latitude: Number, longitude: Number, pickupTime: String }] }, opts));
export const VehicleLocation = tenantModel('VehicleLocation', new Schema({ vehicleId: ObjectId, driverId: ObjectId, latitude: Number, longitude: Number, accuracyM: Number, capturedAt: Date }, opts).index({ schoolId: 1, vehicleId: 1, capturedAt: -1 }));
export const toId = (id) => new Types.ObjectId(String(id));

/** One-time links sent by email (password reset, email verification). Only a hash is stored; the row deletes itself after it expires. */
export const AuthToken = globalModel('AuthToken', new Schema({
    userId: { type: ObjectId, required: true, index: true },
    purpose: { type: String, enum: ['password_reset', 'email_verify'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true }, usedAt: { type: Date, default: null },
}, opts).index({ expiresAt: 1 }, { expireAfterSeconds: 0 }));
/** Payment-provider events we already handled, so a retried webhook is applied only once. */
export const WebhookEvent = globalModel('WebhookEvent', new Schema({
    eventId: { type: String, required: true, unique: true }, source: String, type: String,
}, opts).index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }));
/** Razorpay plans we already created (one per price), so subscribing never creates duplicate plans. */
export const RazorpayPlanCache = globalModel('RazorpayPlanCache', new Schema({ key: { type: String, required: true, unique: true }, planId: { type: String, required: true } }, opts));
