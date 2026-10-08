/**
 * Fills a LOCAL database with realistic demo data so you can log in as every role immediately.
 *
 *   npm run seed:demo        (run it again any time: it wipes and recreates only the demo data)
 *
 * Safety: all demo accounts share one public password, so this script refuses to run against
 * production or a non-local database unless you set ALLOW_DEMO_SEED=true on purpose.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { AuthToken } from '../src/models.js';
import { AcademicYear, AdmissionApplication, AdmissionInquiry, ApplicantProfile, Attendance, AuditLog, Classroom, Exam, FeeCharge, FeeHead, FeePayment, Homework, InquiryMessage, LibraryBook, LibraryLoan, Membership, Notification, PlatformAdmin, PublicSchool, School, SchoolProfile, SchoolSupportTicket, Session, Student, StudentTransport, Subscription, TeacherAssignment, TimetableEntry, TransportRoute, TransportVehicle, User, VehicleLocation, tenantModels, } from '../src/models.js';
import { runInScope } from '../src/tenant-scope.js';
import { seedPlans } from '../src/seed/plans.js';
export const DEMO_PASSWORD = 'Demo@12345!';
const DOMAIN = 'demo.shikshly.test';
const email = (name) => `${name}@${DOMAIN}`;
const oid = () => new Types.ObjectId();
const IST = 'Asia/Kolkata';
const ymd = (offsetDays) => {
    const d = new Date(Date.now() + offsetDays * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(d);
};
const isWeekday = (date) => ![0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
function guardAgainstRealDatabases() {
    const uri = process.env.MONGO_URI || '';
    const local = /127\.0\.0\.1|localhost/.test(uri);
    if (process.env.ALLOW_DEMO_SEED === 'true')
        return;
    if (process.env.NODE_ENV === 'production' || !local)
        throw new Error('Refusing to seed demo data: this does not look like a local development database.\nDemo accounts use a public password. If you really mean it, set ALLOW_DEMO_SEED=true.');
}
async function wipeDemoData() {
    const schools = await School.find({ slug: { $in: ['demo-school-a', 'demo-school-b'] } }).select('_id').lean();
    const schoolIds = schools.map(s => s._id);
    const users = await User.find({ email: { $regex: `@${DOMAIN.replace(/\./g, '\\.')}$` } }).select('_id').lean();
    const userIds = users.map(u => u._id);
    for (const model of tenantModels)
        await model.deleteMany({ schoolId: { $in: schoolIds } });
    await PublicSchool.deleteMany({ schoolId: { $in: schoolIds } });
    await School.deleteMany({ _id: { $in: schoolIds } });
    await Session.deleteMany({ userId: { $in: userIds } });
    await ApplicantProfile.deleteMany({ userId: { $in: userIds } });
    await PlatformAdmin.deleteMany({ userId: { $in: userIds } });
    await AuthToken.deleteMany({ userId: { $in: userIds } });
    await User.deleteMany({ _id: { $in: userIds } });
}
async function main() {
    if (!process.env.MONGO_URI)
        throw new Error('MONGO_URI is required (see apps/api/.env)');
    guardAgainstRealDatabases();
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
    await runInScope({ system: true }, async () => {
        await seedPlans();
        await wipeDemoData();
        const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
        const accounts = [];
        const makeUser = async (key, name, role, school, phone = '') => {
            const user = await User.create({ name, email: email(key), phone, passwordHash, emailVerifiedAt: new Date() });
            accounts.push({ role, school, email: user.email });
            return user;
        };
        const join = (schoolId, userId, role, smsConsent = false) => Membership.create({ schoolId, userId, role, status: 'active', smsConsent });
        // ---------- Platform admin (only one can ever exist)
        const existingAdmin = await PlatformAdmin.findOne({}).lean();
        let platformAdminCreated = false;
        if (!existingAdmin) {
            const admin = await User.create({ name: 'Demo Platform Admin', email: email('admin'), passwordHash, emailVerifiedAt: new Date() });
            await PlatformAdmin.create({ userId: admin._id, status: 'active' });
            accounts.push({ role: 'platform admin', school: '(whole platform)', email: admin.email, context: 'platform_admin' });
            platformAdminCreated = true;
        }
        const yearDates = { startDate: new Date('2026-04-01'), endDate: new Date('2027-03-31') };
        const periodEnd = new Date(Date.now() + 365 * 86_400_000);
        // ---------- School A (Premium: every feature unlocked)
        const A = oid();
        await School.create({ _id: A, name: 'Demo Public School A', slug: 'demo-school-a', status: 'active' });
        await Subscription.create({ schoolId: A, planKey: 'premium', status: 'active', billingPeriod: 'annual', periodEnd });
        await SchoolProfile.create({ schoolId: A, publicName: 'Demo Public School A', area: 'Indiranagar', city: 'Bengaluru', state: 'Karnataka', country: 'India', latitude: 12.9784, longitude: 77.6408, description: 'A friendly demo school used for testing. All data here is fake.', phone: '9000000001', email: 'hello@demo-school-a.test', facilities: ['Library', 'Science lab', 'Playground', 'School bus'], isPublic: true, photos: [] });
        await PublicSchool.create({ schoolId: A, slug: 'demo-school-a', name: 'Demo Public School A', area: 'Indiranagar', city: 'Bengaluru', state: 'Karnataka', country: 'India', latitude: 12.9784, longitude: 77.6408, description: 'A friendly demo school used for testing. All data here is fake.', facilities: ['Library', 'Science lab', 'Playground', 'School bus'], photos: [], isPublic: true });
        const S = 'Demo Public School A';
        const owner = await makeUser('owner.a', 'Olivia Owner', 'owner', S);
        const principal = await makeUser('principal.a', 'Priya Principal', 'principal', S);
        const admission = await makeUser('admission.a', 'Adam Admissions', 'admission staff', S);
        const accountant = await makeUser('accountant.a', 'Asha Accountant', 'accountant', S);
        const teacher1 = await makeUser('teacher1.a', 'Tara Teacher (Class 8-A)', 'teacher', S);
        const teacher2 = await makeUser('teacher2.a', 'Tarun Teacher (Class 8-B)', 'teacher', S);
        const librarian = await makeUser('librarian.a', 'Lata Librarian', 'librarian', S);
        const driver = await makeUser('driver.a', 'Dev Driver', 'bus driver', S);
        const parent1 = await makeUser('parent1.a', 'Pooja Sharma (parent of 2 children)', 'parent', S, '9876543210');
        const parent2 = await makeUser('parent2.a', 'Prakash Singh (parent of 1 child)', 'parent', S, '9876543211');
        const studentUser = await makeUser('student1.a', 'Aarav Sharma', 'student', S);
        for (const [u, r] of [[owner, 'owner'], [principal, 'principal'], [admission, 'admission_staff'], [accountant, 'accountant'], [teacher1, 'teacher'], [teacher2, 'teacher'], [librarian, 'librarian'], [driver, 'bus_driver'], [parent2, 'parent'], [studentUser, 'student']])
            await join(A, u._id, r);
        await join(A, parent1._id, 'parent', true); // parent1 has agreed to SMS alerts
        const year = await AcademicYear.create({ schoolId: A, name: '2026-27', ...yearDates, isCurrent: true });
        const [c8a, c8b, c9a] = await Promise.all([
            Classroom.create({ schoolId: A, academicYearId: year._id, name: 'Class 8', section: 'A', teacherIds: [teacher1._id] }),
            Classroom.create({ schoolId: A, academicYearId: year._id, name: 'Class 8', section: 'B', teacherIds: [teacher2._id] }),
            Classroom.create({ schoolId: A, academicYearId: year._id, name: 'Class 9', section: 'A', teacherIds: [] }),
        ]);
        await TeacherAssignment.create({ schoolId: A, teacherId: teacher1._id, classId: c8a._id, subject: 'Mathematics' });
        await TeacherAssignment.create({ schoolId: A, teacherId: teacher2._id, classId: c8b._id, subject: 'Science' });
        const mk = (name, no, classId, extra = {}) => Student.create({ schoolId: A, name, admissionNo: no, classId, academicYearId: year._id, status: 'active', dateOfBirth: new Date('2012-06-15'), guardianIds: [], ...extra });
        const aarav = await mk('Aarav Sharma', 'A-1001', c8a._id, { userId: studentUser._id, guardianIds: [parent1._id] });
        const diya = await mk('Diya Verma', 'A-1002', c8a._id);
        const kabir = await mk('Kabir Singh', 'A-1003', c8a._id, { guardianIds: [parent2._id] });
        const ananya = await mk('Ananya Gupta', 'A-1004', c8a._id);
        const rohan = await mk('Rohan Mehta', 'A-1005', c8a._id);
        const ishita = await mk('Ishita Das', 'A-1006', c8a._id);
        const meera = await mk('Meera Sharma', 'A-2001', c8b._id, { guardianIds: [parent1._id] });
        const b2 = await mk('Vihaan Joshi', 'A-2002', c8b._id);
        const b3 = await mk('Saanvi Reddy', 'A-2003', c8b._id);
        const n1 = await mk('Advait Kulkarni', 'A-3001', c9a._id);
        const n2 = await mk('Myra Kapoor', 'A-3002', c9a._id);
        const n3 = await mk('Reyansh Iyer', 'A-3003', c9a._id);
        // ---------- 30 days of attendance (weekdays only, deterministic pattern)
        const rosterByClass = [[c8a._id, teacher1._id, [aarav, diya, kabir, ananya, rohan, ishita]], [c8b._id, teacher2._id, [meera, b2, b3]], [c9a._id, teacher1._id, [n1, n2, n3]]];
        const attendanceRows = [];
        for (let back = 29; back >= 0; back--) {
            const date = ymd(-back);
            if (!isWeekday(date))
                continue;
            for (const [classId, markedBy, kids] of rosterByClass)
                kids.forEach((kid, i) => {
                    const n = i * 7 + back * 3;
                    const status = n % 11 === 0 ? 'absent' : n % 13 === 0 ? 'late' : n % 17 === 0 ? 'excused' : 'present';
                    attendanceRows.push({ schoolId: A, studentId: kid._id, classId, date, status, note: '', markedBy });
                });
        }
        await Attendance.insertMany(attendanceRows);
        // ---------- homework, exam, timetable
        await Homework.create({ schoolId: A, classId: c8a._id, teacherId: teacher1._id, title: 'Chapter 5 practice sums', instructions: 'Solve exercise 5.2, questions 1 to 10.', dueAt: new Date(Date.now() + 3 * 86_400_000), status: 'assigned' });
        await Homework.create({ schoolId: A, classId: c8a._id, teacherId: teacher1._id, title: 'Algebra worksheet', instructions: 'Complete the worksheet handed out in class.', dueAt: new Date(Date.now() + 6 * 86_400_000), status: 'assigned' });
        await Exam.create({ schoolId: A, academicYearId: year._id, name: 'Unit Test 1', startsOn: new Date('2026-08-10'), endsOn: new Date('2026-08-14'), status: 'published', subjects: [{ classId: c8a._id, name: 'Mathematics', maxMarks: 50, results: [aarav, diya, kabir].map((s, i) => ({ studentId: s._id, marks: 44 - i * 6, grade: ['A', 'B', 'C'][i], published: true })) }] });
        for (const [p, subject] of [[1, 'Mathematics'], [2, 'English']])
            await TimetableEntry.create({ schoolId: A, academicYearId: year._id, classId: c8a._id, weekday: 1, periodNo: p, startsAt: p === 1 ? '09:00' : '09:45', endsAt: p === 1 ? '09:45' : '10:30', subject, teacherId: teacher1._id, room: `R-${p}` });
        // ---------- fees (one head, one charge per Class 8-A student; mixed paid / partial / due)
        const head = await FeeHead.create({ schoolId: A, academicYearId: year._id, name: 'Tuition Fee - Term 1', amountPaise: 1_250_000, active: true });
        const charges = [];
        for (const [i, kid] of [aarav, diya, kabir, ananya, rohan, ishita].entries()) {
            const paid = i < 3 ? 1_250_000 : i === 3 ? 500_000 : 0;
            const charge = await FeeCharge.create({ schoolId: A, academicYearId: year._id, studentId: kid._id, headId: head._id, label: 'Tuition Fee - Term 1', amountPaise: 1_250_000, discountPaise: 0, finePaise: 0, dueDate: new Date(Date.now() + (i - 2) * 86_400_000 * 10), paidPaise: paid, status: paid === 1_250_000 ? 'paid' : paid > 0 ? 'partial' : 'due' });
            charges.push(charge);
            if (paid)
                await FeePayment.create({ schoolId: A, studentId: kid._id, requestKey: `demo-payment-${i}`, amountPaise: paid, method: 'cash', status: 'paid', receiptNo: `R-DEMO${1000 + i}`, allocations: [{ chargeId: charge._id, amountPaise: paid }], paidAt: new Date(Date.now() - (i + 1) * 5 * 86_400_000) });
        }
        // ---------- library, transport
        const book = await LibraryBook.create({ schoolId: A, title: 'Wings of Fire', author: 'A. P. J. Abdul Kalam', isbn: '9788173711466', shelfCode: 'B-12', totalCopies: 3, active: true });
        await LibraryBook.create({ schoolId: A, title: 'Mathematics Made Easy', author: 'R. Rao', isbn: '9780000000001', shelfCode: 'M-03', totalCopies: 5, active: true });
        await LibraryLoan.create({ schoolId: A, bookId: book._id, studentId: aarav._id, issuedBy: librarian._id, dueDate: new Date(Date.now() + 7 * 86_400_000), status: 'issued' });
        const bus = await TransportVehicle.create({ schoolId: A, name: 'Bus 1', registrationNo: 'KA01AB1234', capacity: 40, driverId: driver._id, active: true });
        const route = await TransportRoute.create({ schoolId: A, academicYearId: year._id, vehicleId: bus._id, name: 'Indiranagar Loop', active: true, stops: [{ name: 'CMH Road', order: 1, latitude: 12.9784, longitude: 77.6408, pickupTime: '07:30' }, { name: '100 Feet Road', order: 2, latitude: 12.9716, longitude: 77.6412, pickupTime: '07:45' }] });
        await StudentTransport.create({ schoolId: A, academicYearId: year._id, studentId: aarav._id, routeId: route._id, stopId: route.stops[0]._id });
        await VehicleLocation.create({ schoolId: A, vehicleId: bus._id, driverId: driver._id, latitude: 12.975, longitude: 77.641, accuracyM: 8, capturedAt: new Date() });
        // ---------- admissions: an applicant who asked a question and submitted an application
        const applicant = await User.create({ name: 'Anita Applicant', email: email('applicant'), passwordHash, emailVerifiedAt: new Date() });
        await ApplicantProfile.create({ userId: applicant._id, phone: '9000000099' });
        accounts.push({ role: 'admission applicant', school: S, email: applicant.email, context: 'applicant' });
        const inquiry = await AdmissionInquiry.create({ schoolId: A, applicantUserId: applicant._id, name: 'Anita Applicant', email: applicant.email, phone: '9000000099', message: 'Do you have seats in Class 6 for next year?', status: 'new' });
        await InquiryMessage.create({ schoolId: A, inquiryId: inquiry._id, senderUserId: applicant._id, senderType: 'applicant', body: 'Do you have seats in Class 6 for next year?' });
        await AdmissionApplication.create({ schoolId: A, applicantUserId: applicant._id, inquiryId: inquiry._id, studentName: 'Rhea Applicant', dateOfBirth: new Date('2014-03-20'), requestedGrade: 'Class 6', academicYearId: year._id, status: 'submitted' });
        // ---------- small extras so dashboards and lists are not empty
        await SchoolSupportTicket.create({ schoolId: A, createdBy: parent1._id, subject: 'Question about the fee receipt', body: 'Please share a copy of the Term 1 receipt.', status: 'open', priority: 'normal' });
        await Notification.create({ schoolId: A, recipientId: parent1._id, type: 'attendance_absent', message: 'Aarav Sharma was marked absent yesterday.', metadata: { studentId: String(aarav._id) } });
        await AuditLog.create({ schoolId: A, actorId: owner._id, role: 'owner', action: 'school.profile_updated', entity: 'school_profile', entityId: String(A), meta: {} });
        // ---------- School B (Basic plan: no fees/payroll/library/transport) used to test that schools cannot see each other
        const B = oid();
        await School.create({ _id: B, name: 'Demo Public School B', slug: 'demo-school-b', status: 'active' });
        await Subscription.create({ schoolId: B, planKey: 'basic', status: 'active', billingPeriod: 'monthly', periodEnd });
        await SchoolProfile.create({ schoolId: B, publicName: 'Demo Public School B', area: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', country: 'India', latitude: 12.9352, longitude: 77.6245, description: 'A second demo school, on the Basic plan.', facilities: ['Playground'], isPublic: true, photos: [] });
        await PublicSchool.create({ schoolId: B, slug: 'demo-school-b', name: 'Demo Public School B', area: 'Koramangala', city: 'Bengaluru', state: 'Karnataka', country: 'India', latitude: 12.9352, longitude: 77.6245, description: 'A second demo school, on the Basic plan.', facilities: ['Playground'], photos: [], isPublic: true });
        const SB = 'Demo Public School B';
        const ownerB = await makeUser('owner.b', 'Bela Owner', 'owner', SB);
        const teacherB = await makeUser('teacher.b', 'Tina Teacher', 'teacher', SB);
        const parentB = await makeUser('parent.b', 'Pallavi Rao', 'parent', SB);
        await join(B, ownerB._id, 'owner');
        await join(B, teacherB._id, 'teacher');
        await join(B, parentB._id, 'parent');
        const yearB = await AcademicYear.create({ schoolId: B, name: '2026-27', ...yearDates, isCurrent: true });
        const classB = await Classroom.create({ schoolId: B, academicYearId: yearB._id, name: 'Class 8', section: 'A', teacherIds: [teacherB._id] });
        await TeacherAssignment.create({ schoolId: B, teacherId: teacherB._id, classId: classB._id, subject: 'English' });
        await Student.create({ schoolId: B, name: 'Neha Rao', admissionNo: 'B-1001', classId: classB._id, academicYearId: yearB._id, status: 'active', guardianIds: [parentB._id] });
        await Student.create({ schoolId: B, name: 'Arjun Nair', admissionNo: 'B-1002', classId: classB._id, academicYearId: yearB._id, status: 'active', guardianIds: [] });
        // ---------- print the cheat sheet
        const pad = (s, n) => s.padEnd(n);
        console.log('\nDemo data is ready.\n');
        console.log(`${pad('ROLE', 38)}${pad('EMAIL', 40)}LOGIN "I'M SIGNING IN AS"`);
        for (const a of accounts)
            console.log(`${pad(a.role + (a.school.startsWith('(') ? '' : ' - ' + a.school.replace('Demo Public School ', 'School ')), 38)}${pad(a.email, 40)}${a.context === 'platform_admin' ? 'Platform administrator' : a.context === 'applicant' ? 'Admission applicant' : 'School team / family member'}`);
        console.log(`\nPassword for every account: ${DEMO_PASSWORD}`);
        if (!platformAdminCreated)
            console.log('Note: a platform admin already exists in this database, so no demo platform admin was created.');
        console.log(`\nSchool A id: ${A}\nSchool B id: ${B}\nOpen http://localhost:5173 and sign in. Run "npm run smoke" for an automatic end-to-end check.\n`);
    });
    await mongoose.disconnect();
}
main().catch(async (error) => { console.error(`\n${error.message}\n`); await mongoose.disconnect().catch(() => undefined); process.exitCode = 1; });
