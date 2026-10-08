/**
 * End-to-end check of the RUNNING API using the demo data.
 *
 *   npm run smoke          (re-creates the demo data, then runs every check below)
 *   npm run smoke:only     (runs the checks against whatever demo data is already there)
 *
 * It signs in as real demo users and tries both the things each role SHOULD be able to do
 * and, more importantly, the things it must NOT be able to do (seeing another school's data,
 * another child's attendance, a plan feature the school has not bought...).
 *
 * Exit code 0 = everything passed, 1 = at least one check failed.
 */
import { readFile } from 'node:fs/promises';
const API = (process.env.SMOKE_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const PASSWORD = 'Demo@12345!';
const DOMAIN = 'demo.shikshly.test';
async function call(method, path, opts = {}) {
    const headers = { Accept: 'application/json', ...(opts.headers || {}) };
    if (opts.token)
        headers.Authorization = `Bearer ${opts.token}`;
    let body;
    if (opts.rawBody !== undefined) {
        body = opts.rawBody;
        headers['Content-Type'] = 'application/json';
    }
    else if (opts.body !== undefined) {
        body = JSON.stringify(opts.body);
        headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${API}${path}`, { method, headers, body });
    return { status: response.status, json: await response.json().catch(() => null) };
}
const get = (path, token) => call('GET', path, { token });
const post = (path, body, token) => call('POST', path, { token, body });
class Skip extends Error {
}
const results = [];
let group = '';
const section = (name) => { group = name; console.log(`\n${name}`); };
async function check(name, fn) {
    try {
        await fn();
        results.push({ group, name, status: 'pass' });
        console.log(`  \u2713 ${name}`);
    }
    catch (e) {
        if (e instanceof Skip) {
            results.push({ group, name, status: 'skip', detail: e.message });
            console.log(`  - ${name} (skipped: ${e.message})`);
        }
        else {
            const detail = e.message;
            results.push({ group, name, status: 'fail', detail });
            console.log(`  \u2717 ${name}\n      ${detail}`);
        }
    }
}
function expect(condition, message) { if (!condition)
    throw new Error(message); }
const expectStatus = (r, status, what = 'response') => expect(r.status === status, `${what}: expected HTTP ${status} but got ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
const names = (rows) => rows.map(r => r.name).sort();
const tokens = {};
async function login(key, context = 'member') {
    const r = await post('/api/auth/login', { email: `${key}@${DOMAIN}`, password: PASSWORD, context });
    expectStatus(r, 200, `login ${key}`);
    expect(typeof r.json?.token === 'string', `login ${key}: no token returned`);
    tokens[key] = r.json.token;
    return r.json;
}
const istDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
async function main() {
    console.log(`Shikshly smoke test against ${API}`);
    section('1. The API is up');
    await check('GET /health answers', async () => { const r = await get('/health'); expectStatus(r, 200); expect(r.json.status === 'ok', 'status is not ok'); });
    await check('GET /ready says the database is connected', async () => { const r = await get('/ready'); expectStatus(r, 200, 'ready'); expect(r.json.database === 'connected', 'database not connected'); });
    section('2. Everyone can sign in');
    const demoLogins = ['owner.a', 'principal.a', 'admission.a', 'accountant.a', 'teacher1.a', 'teacher2.a', 'librarian.a', 'driver.a', 'parent1.a', 'parent2.a', 'student1.a', 'owner.b', 'teacher.b', 'parent.b'];
    for (const key of demoLogins)
        await check(`${key} can sign in`, async () => { const j = await login(key); expect(!!j.role, 'no role in login response'); });
    await check('applicant can sign in (applicant login)', async () => { await login('applicant', 'applicant'); });
    await check('platform admin can sign in (platform login)', async () => { await login('admin', 'platform_admin'); });
    await check('GET /auth/me returns the right role and plan', async () => {
        const a = await get('/api/auth/me', tokens['owner.a']);
        expectStatus(a, 200);
        expect(a.json.role === 'owner' && a.json.plan === 'premium', `got ${JSON.stringify(a.json)}`);
        const b = await get('/api/auth/me', tokens['owner.b']);
        expect(b.json.plan === 'basic', 'School B should be on the basic plan');
    });
    // ids used by later checks
    let classA = {}, studentA = {}, classB = {}, studentB = {};
    section('3. Look up the demo records');
    await check('owner A sees 3 classes and 12 students', async () => {
        const classes = await get('/api/school/classes', tokens['owner.a']);
        expectStatus(classes, 200);
        classA = Object.fromEntries(classes.json.map((c) => [`${c.name} ${c.section}`, c._id]));
        expect(classes.json.length === 3, `expected 3 classes, got ${classes.json.length}`);
        const students = await get('/api/school/students?limit=100', tokens['owner.a']);
        expectStatus(students, 200);
        studentA = Object.fromEntries(students.json.map((s) => [s.name, s._id]));
        expect(students.json.length === 12, `expected 12 students, got ${students.json.length}`);
    });
    await check('owner B sees only School B\'s class and students', async () => {
        const classes = await get('/api/school/classes', tokens['owner.b']);
        expectStatus(classes, 200);
        classB = Object.fromEntries(classes.json.map((c) => [`${c.name} ${c.section}`, c._id]));
        expect(classes.json.length === 1, `expected 1 class, got ${classes.json.length}`);
        const students = await get('/api/school/students', tokens['owner.b']);
        expectStatus(students, 200);
        studentB = Object.fromEntries(students.json.map((s) => [s.name, s._id]));
        expect(names(students.json).join() === 'Arjun Nair,Neha Rao', `got ${names(students.json).join()}`);
    });
    section('4. SCHOOLS CANNOT SEE EACH OTHER (the most important group)');
    await check('School B owner cannot open a School A student by id', async () => { expectStatus(await get(`/api/school/students/${studentA['Aarav Sharma']}`, tokens['owner.b']), 404); });
    await check('School B owner cannot read School A attendance', async () => { const r = await get(`/api/learning/attendance/classes/${classA['Class 8 A']}/${istDate()}`, tokens['owner.b']); expect(r.status === 404 || (r.status === 200 && r.json.length === 0), `leak! status ${r.status} rows ${r.json?.length}`); });
    await check('School B owner cannot read School A fee charges', async () => { const r = await get(`/api/operations/fees/students/${studentA['Aarav Sharma']}`, tokens['owner.b']); expect([403, 404].includes(r.status), `expected 403/404, got ${r.status}`); });
    await check('School B teacher cannot mark attendance in a School A class', async () => { const r = await post(`/api/learning/attendance/classes/${classA['Class 8 A']}/${istDate()}`, { records: [{ studentId: studentA['Aarav Sharma'], status: 'absent' }] }, tokens['teacher.b']); expect(r.status === 404, `expected 404, got ${r.status}`); });
    await check('School B parent cannot read a School A child\'s attendance', async () => { expectStatus(await get(`/api/learning/me/children/${studentA['Aarav Sharma']}/attendance/last-30-days`, tokens['parent.b']), 404); });
    await check('School B dashboard counts only School B', async () => { const r = await get('/api/school/dashboard/overview', tokens['owner.b']); expectStatus(r, 200); expect(r.json.cards.activeStudents === 2, `expected 2 students, got ${r.json.cards.activeStudents}`); });
    await check('School B owner cannot invite someone into a School A student', async () => { const r = await post('/api/school/invites', { role: 'parent', studentId: studentA['Aarav Sharma'] }, tokens['owner.b']); expect([403, 404].includes(r.status), `expected 403/404, got ${r.status}`); });
    await check('A School A student id cannot be used in School B fee charges', async () => { const r = await post('/api/operations/fees/charges', { studentId: studentA['Aarav Sharma'], headId: '000000000000000000000000', label: 'x', amountPaise: 100, dueDate: '2030-01-01' }, tokens['owner.b']); expect([400, 403, 404].includes(r.status), `expected 400/403/404, got ${r.status}`); });
    section('5. People only see what belongs to them');
    await check('teacher 1 sees only Class 8 A', async () => { const r = await get('/api/school/classes', tokens['teacher1.a']); expect(r.json.map((c) => `${c.name} ${c.section}`).join() === 'Class 8 A', `got ${r.json.map((c) => `${c.name} ${c.section}`).join()}`); });
    await check('teacher 2 sees only Class 8 B', async () => { const r = await get('/api/school/classes', tokens['teacher2.a']); expect(r.json.map((c) => `${c.name} ${c.section}`).join() === 'Class 8 B', 'wrong classes'); });
    await check('teacher 1 cannot open Class 8 B attendance', async () => { expectStatus(await get(`/api/learning/attendance/classes/${classA['Class 8 B']}/${istDate()}`, tokens['teacher1.a']), 404); });
    await check('teacher 2 cannot mark attendance for Class 8 A', async () => { expectStatus(await post(`/api/learning/attendance/classes/${classA['Class 8 A']}/${istDate()}`, { records: [{ studentId: studentA['Aarav Sharma'], status: 'present' }] }, tokens['teacher2.a']), 404); });
    await check('teacher 1 cannot open a Class 9 student (not assigned)', async () => { expectStatus(await get(`/api/school/students/${studentA['Advait Kulkarni']}`, tokens['teacher1.a']), 404); });
    await check('parent 1 sees exactly their 2 children', async () => { const r = await get('/api/school/students', tokens['parent1.a']); expect(names(r.json).join() === 'Aarav Sharma,Meera Sharma', `got ${names(r.json).join()}`); });
    await check('parent 2 sees exactly their 1 child', async () => { const r = await get('/api/school/students', tokens['parent2.a']); expect(names(r.json).join() === 'Kabir Singh', `got ${names(r.json).join()}`); });
    await check('parent 2 cannot read parent 1\'s child attendance', async () => { expectStatus(await get(`/api/learning/me/children/${studentA['Aarav Sharma']}/attendance/last-30-days`, tokens['parent2.a']), 404); });
    await check('parent 2 cannot read parent 1\'s child fees', async () => { expectStatus(await get(`/api/operations/fees/students/${studentA['Aarav Sharma']}`, tokens['parent2.a']), 404); });
    await check('student sees only themselves', async () => { const r = await get('/api/school/students', tokens['student1.a']); expect(names(r.json).join() === 'Aarav Sharma', `got ${names(r.json).join()}`); });
    await check('student cannot open a classmate', async () => { expectStatus(await get(`/api/school/students/${studentA['Diya Verma']}`, tokens['student1.a']), 404); });
    section('6. Roles can only do their own job');
    await check('parent cannot add a student', async () => { expectStatus(await post('/api/school/students', { name: 'Hacker Kid', classId: classA['Class 8 A'] }, tokens['parent1.a']), 403); });
    await check('teacher cannot create invites', async () => { expectStatus(await post('/api/school/invites', { role: 'parent', studentId: studentA['Aarav Sharma'] }, tokens['teacher1.a']), 403); });
    await check('accountant cannot see the owner dashboard', async () => { expectStatus(await get('/api/school/dashboard/overview', tokens['accountant.a']), 403); });
    await check('principal cannot approve payroll (owner only)', async () => { expectStatus(await post('/api/operations/payroll/000000000000000000000000/approve', {}, tokens['principal.a']), 403); });
    await check('only the owner can appoint a principal', async () => { expectStatus(await post('/api/school/invites', { role: 'principal' }, tokens['principal.a']), 403); });
    await check('school owner cannot use platform admin routes', async () => { expectStatus(await get('/api/platform/overview', tokens['owner.a']), 403); });
    await check('platform admin can use platform routes', async () => { const r = await get('/api/platform/overview', tokens['admin']); expectStatus(r, 200); expect(r.json.schools >= 2, 'expected at least the 2 demo schools'); });
    await check('applicant cannot use school routes', async () => { const r = await get('/api/school/students', tokens['applicant']); expect([401, 403].includes(r.status), `expected 401/403, got ${r.status}`); });
    section('7. Plans switch features on and off');
    await check('School B (Basic) is blocked from fees', async () => { const r = await get('/api/operations/fees/heads', tokens['owner.b']); expectStatus(r, 403); expect(/plan/i.test(r.json.message), `message: ${r.json.message}`); });
    await check('School B (Basic) is blocked from transport', async () => { expectStatus(await post('/api/operations/transport/vehicles', { name: 'x', registrationNo: 'KA01', capacity: 10, driverUserId: '000000000000000000000000' }, tokens['owner.b']), 403); });
    await check('School A (Premium) can use fees', async () => { const r = await get('/api/operations/fees/heads', tokens['accountant.a']); expectStatus(r, 200); expect(r.json.length === 1, 'expected 1 fee head'); });
    await check('public plans list has 4 plans', async () => { const r = await get('/api/public/plans'); expectStatus(r, 200); expect(r.json.length === 4, `got ${r.json.length}`); });
    section('8. Attendance: teacher marks, parent sees');
    const today = istDate();
    await check('teacher 1 marks Class 8 A (Aarav absent, rest present)', async () => {
        const roster = await get(`/api/learning/attendance/classes/${classA['Class 8 A']}/${today}`, tokens['teacher1.a']);
        expectStatus(roster, 200);
        expect(roster.json.length === 6, `expected 6 students, got ${roster.json.length}`);
        const records = roster.json.map((s) => ({ studentId: s._id, status: s.name === 'Aarav Sharma' ? 'absent' : 'present' }));
        const saved = await post(`/api/learning/attendance/classes/${classA['Class 8 A']}/${today}`, { records }, tokens['teacher1.a']);
        expectStatus(saved, 200);
        expect(saved.json.count === 6, 'expected 6 saved');
    });
    await check('marking attendance twice updates instead of duplicating', async () => {
        const again = await post(`/api/learning/attendance/classes/${classA['Class 8 A']}/${today}`, { records: [{ studentId: studentA['Aarav Sharma'], status: 'absent' }] }, tokens['teacher1.a']);
        expectStatus(again, 200);
        const roster = await get(`/api/learning/attendance/classes/${classA['Class 8 A']}/${today}`, tokens['teacher1.a']);
        expect(roster.json.filter((s) => s.attendance).length === 6, 'attendance rows were duplicated or lost');
    });
    await check('attendance for a future date is rejected', async () => { const f = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10); expectStatus(await post(`/api/learning/attendance/classes/${classA['Class 8 A']}/${f}`, { records: [{ studentId: studentA['Aarav Sharma'], status: 'present' }] }, tokens['teacher1.a']), 400); });
    await check('a student from another class cannot be added to this class\'s attendance', async () => { expectStatus(await post(`/api/learning/attendance/classes/${classA['Class 8 A']}/${today}`, { records: [{ studentId: studentA['Meera Sharma'], status: 'present' }] }, tokens['teacher1.a']), 400); });
    await check('parent 1 sees today as absent in the 30-day view', async () => {
        const r = await get(`/api/learning/me/children/${studentA['Aarav Sharma']}/attendance/last-30-days`, tokens['parent1.a']);
        expectStatus(r, 200);
        expect(r.json.days.length === 30, `expected 30 days, got ${r.json.days.length}`);
        expect(r.json.days[29].status === 'absent', `today should be absent, got ${r.json.days[29].status}`);
        expect(r.json.summary.notRecorded > 0, 'weekends should show as not recorded, not absent');
    });
    await check('teacher can queue absence notifications for parents', async () => { const r = await post(`/api/learning/attendance/classes/${classA['Class 8 A']}/${today}/notifications`, {}, tokens['teacher1.a']); expectStatus(r, 200); });
    await check('parent 1 receives the in-app notification', async () => { const r = await get('/api/learning/me/notifications', tokens['parent1.a']); expectStatus(r, 200); expect(r.json.some((n) => /absent/i.test(n.message) && n.message.includes(today)), 'no absence notification for today found'); });
    section('9. Dashboard numbers are correct');
    await check('owner dashboard: student, class and fee totals are correct', async () => {
        const r = await get('/api/school/dashboard/overview', tokens['owner.a']);
        expectStatus(r, 200);
        expect(r.json.cards.activeStudents === 12, `students: ${r.json.cards.activeStudents}`);
        expect(r.json.cards.classes === 3, `classes: ${r.json.cards.classes}`);
        expect(r.json.cards.feesCollectedPaise === 4_250_000, `collected: ${r.json.cards.feesCollectedPaise} (expected 4250000)`);
        expect(r.json.cards.feesOutstandingPaise === 3_250_000, `outstanding: ${r.json.cards.feesOutstandingPaise} (expected 3250000)`);
        expect(r.json.cards.pendingApplications === 1, `pending applications: ${r.json.cards.pendingApplications}`);
        expect(r.json.graphs.attendance30Days.length === 30 && r.json.graphs.feeCollections12Months.length === 12, 'graph series have the wrong length');
    });
    section('10. Fees');
    await check('accountant records a part-payment and the charge becomes "partial"', async () => {
        const charges = await get(`/api/operations/fees/students/${studentA['Ishita Das']}`, tokens['accountant.a']);
        expectStatus(charges, 200);
        expect(charges.json.length === 1, 'expected 1 charge');
        const paid = await post(`/api/operations/fees/charges/${charges.json[0]._id}/manual-payment`, { amountPaise: 100_000, method: 'cash' }, tokens['accountant.a']);
        expectStatus(paid, 201);
        expect(/^R-/.test(paid.json.receiptNo), 'no receipt number');
        const after = await get(`/api/operations/fees/students/${studentA['Ishita Das']}`, tokens['accountant.a']);
        expect(after.json[0].paidPaise === 100_000 && after.json[0].status === 'partial', `got ${JSON.stringify(after.json[0])}`);
    });
    await check('paying more than is owed is rejected', async () => {
        const charges = await get(`/api/operations/fees/students/${studentA['Aarav Sharma']}`, tokens['accountant.a']);
        expectStatus(await post(`/api/operations/fees/charges/${charges.json[0]._id}/manual-payment`, { amountPaise: 1, method: 'cash' }, tokens['accountant.a']), 400);
    });
    await check('parent 1 can see their own child\'s fees', async () => { const r = await get(`/api/operations/fees/students/${studentA['Aarav Sharma']}`, tokens['parent1.a']); expectStatus(r, 200); expect(r.json.length === 1, 'expected 1 charge'); });
    section('11. Public pages and admissions');
    await check('school search finds both demo schools by name', async () => { const r = await get('/api/public/schools?name=Demo%20Public'); expectStatus(r, 200); expect(r.json.items.length >= 2, `found ${r.json.items.length}`); });
    await check('"near me" search (2 km around School A) returns only School A', async () => { const r = await get('/api/public/schools?lat=12.9784&lon=77.6408&radiusKm=2'); expectStatus(r, 200); expect(r.json.items.length === 1 && r.json.items[0].slug === 'demo-school-a' && typeof r.json.items[0].distanceKm === 'number', `got ${JSON.stringify(r.json.items.map((i) => i.slug))}`); });
    await check('School A public profile loads, admissions switched on', async () => { const r = await get('/api/public/schools/demo-school-a'); expectStatus(r, 200); expect(r.json.admissionsEnabled === true, 'admissions should be enabled on Premium'); });
    await check('School B (Basic) public profile loads', async () => { expectStatus(await get('/api/public/schools/demo-school-b'), 200); });
    await check('an unknown school is a clean 404', async () => { expectStatus(await get('/api/public/schools/no-such-school'), 404); });
    await check('applicant sees their submitted application', async () => { const r = await get('/api/applicant/applications', tokens['applicant']); expectStatus(r, 200); expect(r.json.length === 1 && r.json[0].status === 'submitted', `got ${JSON.stringify(r.json)}`); });
    await check('admission staff accepts and admits the applicant', async () => {
        const list = await get('/api/operations/admissions/applications', tokens['admission.a']);
        expectStatus(list, 200);
        expect(list.json.length === 1, 'expected 1 application');
        const id = list.json[0]._id;
        expectStatus(await call('PATCH', `/api/operations/admissions/applications/${id}`, { token: tokens['admission.a'], body: { status: 'accepted', decisionNote: 'Welcome' } }), 200, 'accept');
        const admitted = await post(`/api/operations/admissions/applications/${id}/admit`, { classId: classA['Class 8 B'], admissionNo: `A-SMOKE-${Date.now()}` }, tokens['admission.a']);
        expectStatus(admitted, 201, 'admit');
        expect(admitted.json.student?.name === 'Rhea Applicant', 'student was not created from the application');
    });
    section('12. A brand-new school can sign up and invite people');
    const stamp = Date.now();
    const newOwnerEmail = `smoke.owner.${stamp}@${DOMAIN}`;
    let newOwnerToken = '', newSchoolId = '';
    await check('register a new school (owner account is created)', async () => {
        const r = await post('/api/auth/register-school', { schoolName: `Smoke Test School ${stamp}`, name: 'Smoke Owner', email: newOwnerEmail, password: PASSWORD });
        expectStatus(r, 201);
        newOwnerToken = r.json.token;
        newSchoolId = r.json.schoolId;
        const me = await get('/api/auth/me', newOwnerToken);
        expect(me.json.role === 'owner' && me.json.plan === 'free', `got ${JSON.stringify(me.json)}`);
    });
    await check('registering the same email twice is refused', async () => { expectStatus(await post('/api/auth/register-school', { schoolName: 'Dup', name: 'Dup', email: newOwnerEmail, password: PASSWORD }), 409); });
    await check('a Free school cannot use roster features yet', async () => { expectStatus(await get('/api/school/students', newOwnerToken), 403); });
    await check('platform admin upgrades the new school to Basic', async () => {
        if (!tokens['admin'])
            throw new Skip('no demo platform admin');
        const r = await call('PUT', `/api/platform/schools/${newSchoolId}/subscription`, { token: tokens['admin'], body: { planKey: 'basic', status: 'active', periodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString() } });
        expectStatus(r, 200);
    });
    await check('owner creates year, class and student, then invites a teacher who joins', async () => {
        if (!tokens['admin'])
            throw new Skip('needs the platform admin step');
        const y = await post('/api/school/academic-years', { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31', makeCurrent: true }, newOwnerToken);
        expectStatus(y, 201, 'year');
        const c = await post('/api/school/classes', { name: 'Class 1', section: 'A' }, newOwnerToken);
        expectStatus(c, 201, 'class');
        const s = await post('/api/school/students', { name: 'First Student', classId: c.json._id, admissionNo: 'N-1' }, newOwnerToken);
        expectStatus(s, 201, 'student');
        const inv = await post('/api/school/invites', { role: 'teacher' }, newOwnerToken);
        expectStatus(inv, 201, 'invite');
        expect(/join\//.test(inv.json.joinUrl), 'no join link');
        const joined = await post('/api/auth/join', { code: inv.json.code, name: 'New Teacher', email: `smoke.teacher.${stamp}@${DOMAIN}`, password: PASSWORD });
        expectStatus(joined, 201, 'join');
        const again = await post('/api/auth/join', { code: inv.json.code, name: 'Other', email: `smoke.other.${stamp}@${DOMAIN}`, password: PASSWORD });
        expectStatus(again, 400, 'second use of a one-time invite');
        const classes = await get('/api/school/classes', joined.json.token);
        expect(classes.json.length === 0, 'a new teacher with no assignment must see no classes');
    });
    section('12b. History: each person sees only what they need');
    await check('parent 1 sees Aarav\'s history: attendance + fee payment + homework', async () => {
        const r = await get(`/api/learning/me/children/${studentA['Aarav Sharma']}/history?days=90`, tokens['parent1.a']);
        expectStatus(r, 200);
        const types = new Set(r.json.items.map((i) => i.type));
        expect(types.has('attendance') && types.has('fees') && types.has('homework') && types.has('exams'), `sections present: ${[...types].join(',')}`);
        expect(r.json.items.every((x, i, a) => i === 0 || a[i - 1].at >= x.at), 'history is not newest-first');
        expect(r.json.items.some((i) => i.type === 'attendance' && /absent/.test(i.title)), 'today\'s absence missing');
    });
    await check('parent 1 can filter history to fees only', async () => { const r = await get(`/api/learning/me/children/${studentA['Aarav Sharma']}/history?types=fees`, tokens['parent1.a']); expectStatus(r, 200); expect(r.json.items.length > 0 && r.json.items.every((i) => i.type === 'fees'), 'filter ignored'); });
    await check('parent 2 cannot see parent 1\'s child history', async () => { expectStatus(await get(`/api/learning/me/children/${studentA['Aarav Sharma']}/history`, tokens['parent2.a']), 404); });
    await check('School B parent cannot see a School A child\'s history', async () => { expectStatus(await get(`/api/learning/me/children/${studentA['Aarav Sharma']}/history`, tokens['parent.b']), 404); });
    await check('student sees their own history but not a classmate\'s', async () => {
        expectStatus(await get(`/api/learning/me/children/${studentA['Aarav Sharma']}/history`, tokens['student1.a']), 200);
        expectStatus(await get(`/api/learning/me/children/${studentA['Diya Verma']}/history`, tokens['student1.a']), 404);
    });
    await check('teacher cannot use the parent history route', async () => { expectStatus(await get(`/api/learning/me/children/${studentA['Aarav Sharma']}/history`, tokens['teacher1.a']), 403); });
    await check('owner sees school history with who did what', async () => {
        const r = await get('/api/school/activity?limit=200', tokens['owner.a']);
        expectStatus(r, 200);
        const actions = new Set(r.json.map((x) => x.action));
        expect(actions.has('attendance.marked') && actions.has('fee.payment_recorded') && actions.has('admission.application_decided'), `actions seen: ${[...actions].join(', ')}`);
        expect(r.json.find((x) => x.action === 'attendance.marked')?.actorName === 'Tara Teacher (Class 8-A)', 'actor name missing');
    });
    await check('principal sees the same school history', async () => { const r = await get('/api/school/activity?action=attendance.marked', tokens['principal.a']); expectStatus(r, 200); expect(r.json.length > 0 && r.json.every((x) => x.action === 'attendance.marked'), 'action filter failed'); });
    await check('history can be filtered by date and a bad date is a clean 400', async () => {
        const day = new Date().toISOString().slice(0, 10);
        const ok = await get(`/api/school/activity?from=${day}&to=${day}`, tokens['owner.a']);
        expectStatus(ok, 200);
        expect(ok.json.length > 0, 'nothing today');
        expectStatus(await get('/api/school/activity?from=yesterday', tokens['owner.a']), 400);
    });
    await check('owner sees sign-in history (no IP addresses exposed)', async () => {
        const r = await get('/api/school/history/sign-ins', tokens['owner.a']);
        expectStatus(r, 200);
        expect(r.json.length > 5 && !JSON.stringify(r.json).includes('ipHash'), 'sign-ins missing or leaking ip');
        expect(r.json.every((x) => !x.name.includes('Bela')), 'School B user visible in School A history');
    });
    await check('School B history contains none of School A\'s actions', async () => { const r = await get('/api/school/activity?limit=200', tokens['owner.b']); expectStatus(r, 200); expect(!r.json.some((x) => x.action === 'attendance.marked'), 'cross-school history leak'); });
    await check('teacher, accountant and parent cannot read school history', async () => {
        for (const k of ['teacher1.a', 'accountant.a', 'parent1.a'])
            expectStatus(await get('/api/school/activity', tokens[k]), 403, k);
        for (const k of ['teacher1.a', 'parent1.a'])
            expectStatus(await get('/api/school/history/sign-ins', tokens[k]), 403, k);
    });
    await check('super admin sees platform history (the plan change from step 12)', async () => {
        if (!tokens['admin'])
            throw new Skip('no demo platform admin');
        const r = await get('/api/platform/history', tokens['admin']);
        expectStatus(r, 200);
        const hit = r.json.find((x) => x.action === 'platform.subscription_changed' && x.schoolId === newSchoolId);
        expect(hit && hit.meta.planKey === 'basic' && hit.actor === 'Demo Platform Admin' && /Smoke Test School/.test(hit.school), `got ${JSON.stringify(r.json.slice(0, 2))}`);
        expectStatus(await get(`/api/platform/history?schoolId=${newSchoolId}`, tokens['admin']), 200);
    });
    await check('school owner cannot read platform history', async () => { expectStatus(await get('/api/platform/history', tokens['owner.a']), 403); });
    section('13. Basic attack checks');
    await check('no token is a 401', async () => { expectStatus(await get('/api/school/students'), 401); });
    await check('a garbage token is a 401', async () => { expectStatus(await get('/api/school/students', 'not.a.token'), 401); });
    await check('a token signed with "alg: none" is a 401', async () => {
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const forged = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: '000000000000000000000000', sessionId: '000000000000000000000000', tokenType: 'platform_admin' })}.`;
        expectStatus(await get('/api/platform/overview', forged), 401);
    });
    await check('a wrong password and an unknown email give the same answer', async () => {
        const a = await post('/api/auth/login', { email: `owner.a@${DOMAIN}`, password: 'wrong-password-123' });
        const b = await post('/api/auth/login', { email: `nobody.${stamp}@${DOMAIN}`, password: 'wrong-password-123' });
        expectStatus(a, 401);
        expectStatus(b, 401);
        expect(a.json.message === b.json.message, 'different messages would reveal which emails exist');
    });
    await check('broken JSON is a clean 400, not a crash', async () => { const r = await call('POST', '/api/auth/login', { rawBody: '{"email": ' }); expectStatus(r, 400); });
    await check('NoSQL-injection style login is rejected', async () => { expectStatus(await post('/api/auth/login', { email: { $gt: '' }, password: { $gt: '' } }), 400); });
    await check('a request from a website that is not allowed is refused', async () => { const r = await call('GET', '/api/public/plans', { headers: { Origin: 'https://evil.example' } }); expectStatus(r, 403); });
    await check('unknown routes are a clean 404', async () => { expectStatus(await get('/api/nope'), 404); });
    section('14. Password reset, email confirmation and billing access');
    // In development the API saves every email it "sends" in apps/api/.mail-outbox.jsonl, so this test can click the links.
    const outboxPath = new URL('../.mail-outbox.jsonl', import.meta.url);
    const lastMailTo = async (to, subjectPart) => {
        for (let i = 0; i < 20; i++) {
            const lines = (await readFile(outboxPath, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l));
            const mail = lines.reverse().find(m => m.to === to && m.subject.includes(subjectPart));
            if (mail)
                return mail;
            await new Promise(r => setTimeout(r, 250));
        }
        return null;
    };
    const tokenFrom = (mail) => /token=([\w-]+)/.exec(mail.text)?.[1];
    const resetEmail = `reset.${stamp}@${DOMAIN}`;
    let applicantToken = '';
    await check('forgot-password answers the same for known and unknown emails', async () => {
        const reg = await post('/api/auth/applicant/register', { name: 'Reset Tester', email: resetEmail, password: 'Old-Password-123!' });
        expectStatus(reg, 201);
        applicantToken = reg.json.token;
        const known = await post('/api/auth/forgot-password', { email: resetEmail });
        const unknown = await post('/api/auth/forgot-password', { email: `nobody.${stamp}@${DOMAIN}` });
        expectStatus(known, 200);
        expectStatus(unknown, 200);
        expect(known.json.message === unknown.json.message, 'different answers would reveal which emails have accounts');
    });
    await check('the reset link changes the password, works once, and signs out old sessions', async () => {
        const mail = await lastMailTo(resetEmail, 'Reset your');
        if (!mail)
            throw new Skip('no mail outbox found (API runs elsewhere or MAIL_PROVIDER is not console)');
        const token = tokenFrom(mail);
        expectStatus(await post('/api/auth/reset-password', { token, password: 'short' }), 400, 'too-short password');
        expectStatus(await post('/api/auth/reset-password', { token: 'x'.repeat(43), password: 'New-Password-456!' }), 400, 'unknown token');
        expectStatus(await post('/api/auth/reset-password', { token, password: 'New-Password-456!' }), 200, 'real reset');
        expectStatus(await post('/api/auth/reset-password', { token, password: 'Another-Pass-789!' }), 400, 'second use of the same link');
        expectStatus(await post('/api/auth/login', { email: resetEmail, password: 'Old-Password-123!', context: 'applicant' }), 401, 'old password');
        expectStatus(await post('/api/auth/login', { email: resetEmail, password: 'New-Password-456!', context: 'applicant' }), 200, 'new password');
        expectStatus(await get('/api/auth/me', applicantToken), 401, 'session from before the reset');
    });
    await check('the confirmation link verifies the email once', async () => {
        const mail = await lastMailTo(resetEmail, 'Confirm your');
        if (!mail)
            throw new Skip('no mail outbox found');
        const token = tokenFrom(mail);
        expectStatus(await post('/api/auth/verify-email', { token }), 200);
        expectStatus(await post('/api/auth/verify-email', { token }), 400, 'second use');
    });
    await check('only the owner can see billing', async () => {
        expectStatus(await get('/api/billing/status', tokens['owner.a']), 200, 'owner');
        for (const who of ['teacher1.a', 'accountant.a', 'parent1.a'])
            expectStatus(await get('/api/billing/status', tokens[who]), 403, who);
        expectStatus(await get('/api/billing/status'), 401, 'no token');
    });
    await check('subscribing to a plan with no price (or without Razorpay keys) is refused cleanly', async () => {
        const r = await post('/api/billing/subscribe', { planKey: 'premium' }, tokens['owner.a']);
        expect([409, 503].includes(r.status), `expected 409 or 503 but got ${r.status}`);
        expectStatus(await post('/api/billing/subscribe', { planKey: 'free' }, tokens['owner.a']), 400, 'free is not purchasable');
    });
    await check('a subscription webhook without a valid signature is refused', async () => {
        const r = await call('POST', '/api/webhooks/razorpay', { body: { event: 'subscription.charged', payload: {} }, headers: { 'x-razorpay-signature': 'bad', 'x-razorpay-event-id': `evt_${stamp}` } });
        expect([401, 503].includes(r.status), `expected 401 or 503 but got ${r.status}`);
    });
    section('15. Graph data for every role');
    await check('each role gets its own graph data, and only for its own role', async () => {
        const cases = [['teacher1.a', 'teacher'], ['accountant.a', 'accountant'], ['admission.a', 'admission_staff'], ['librarian.a', 'librarian'], ['driver.a', 'none']];
        for (const [who, kind] of cases) {
            const r = await get('/api/insights', tokens[who]);
            expectStatus(r, 200, who);
            expect(r.json.kind === kind, `${who}: expected kind "${kind}" but got "${r.json.kind}"`);
        }
        expectStatus(await get('/api/insights', tokens['applicant']), 403, 'applicant token');
    });
    await check('a teacher sees graph data only for their own class', async () => {
        const one = await get('/api/insights', tokens['teacher1.a']), two = await get('/api/insights', tokens['teacher2.a']);
        expect(one.json.classes.length > 0 && two.json.classes.length > 0, 'both teachers should have a class');
        expect(!one.json.classes.some(a => two.json.classes.some(b => a.id === b.id)), 'two teachers must not share a class');
        expect(one.json.classes[0].days.length === 7, 'expected 7 days of attendance');
    });
    await check('accountant graph data has 6 months and plausible totals', async () => {
        const r = await get('/api/insights', tokens['accountant.a']);
        expect(r.json.monthly.length === 6, 'expected 6 months');
        expect(r.json.pendingPaise >= 0 && r.json.collectedPaise >= 0, 'totals must not be negative');
    });
    // ---- summary
    const failed = results.filter(r => r.status === 'fail'), skipped = results.filter(r => r.status === 'skip'), passed = results.filter(r => r.status === 'pass');
    console.log(`\n${'='.repeat(60)}\n${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped (${results.length} checks)`);
    if (failed.length) {
        console.log('\nFailed checks:');
        for (const f of failed)
            console.log(`  [${f.group}] ${f.name}\n      ${f.detail}`);
        console.log('\nTip: some checks change data (attendance, payments, admissions). Run "npm run smoke" (not smoke:only) to start from fresh demo data.');
        process.exit(1);
    }
}
main().catch(error => {
    const cause = error?.cause?.code;
    console.error(cause === 'ECONNREFUSED' || /fetch failed/.test(error.message)
        ? `\nCould not reach the API at ${API}.\nStart it first in another terminal: npm run dev:api\n`
        : error);
    process.exit(1);
});
