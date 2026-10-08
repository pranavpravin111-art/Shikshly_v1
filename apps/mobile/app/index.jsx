import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api, getToken, removeToken, saveToken } from '../lib/api';
import MobileInsights from '../lib/MobileInsights';
const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');
const C = { ink: '#172825', moss: '#668a78', cream: '#f6f8f4', line: '#e2e9e2', muted: '#7a8780', white: '#fff', peach: '#f8eee5', sun: '#f7efd9', blue: '#eef1f8' };
export default function Home() {
    const [logged, setLogged] = useState(false);
    const [profile, setProfile] = useState(null);
    const [children, setChildren] = useState([]);
    const [selected, setSelected] = useState('');
    const [attendance, setAttendance] = useState(null);
    const [classes, setClasses] = useState([]);
    const [classId, setClassId] = useState('');
    const [classRows, setClassRows] = useState([]);
    const [saving, setSaving] = useState(false);
    const [smsConsent, setSmsConsent] = useState(false);
    const [homework, setHomework] = useState([]);
    const [error, setError] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [context, setContext] = useState('member');
    const [busy, setBusy] = useState(true);
    const router = useRouter();
    async function load() { try {
        const t = await getToken();
        if (!t) {
            setBusy(false);
            return;
        }
        const me = await api('/auth/me');
        setProfile(me);
        setLogged(true);
        if (me.role === 'parent') {
            const rows = await api('/school/students');
            setChildren(rows);
            if (rows[0])
                setSelected(rows[0]._id);
            const consent = await api(`/sms/me/consent`);
            setSmsConsent(consent.smsConsent);
        }
        else if (['owner', 'principal'].includes(me.role)) {
            setAttendance(await api('/school/dashboard/overview'));
        }
        else if (me.role === 'teacher') {
            const rooms = await api('/school/classes');
            setClasses(rooms);
            if (rooms[0])
                setClassId(rooms[0]._id);
        }
        else if (me.role === 'student') {
            setHomework(await api('/learning/homework'));
        }
    }
    catch (e) {
        await removeToken();
        setError(e.message);
    }
    finally {
        setBusy(false);
    } }
    useEffect(() => { load(); }, []);
    useEffect(() => { if (logged && profile?.role === 'parent' && selected)
        api(`/learning/me/children/${selected}/attendance/last-30-days`).then(setAttendance).catch(e => setError(e.message)); }, [logged, profile, selected]);
    async function signIn() { setBusy(true); setError(''); try {
        const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, context }) });
        await saveToken(result.token);
        await load();
    }
    catch (e) {
        setError(e.message);
        setBusy(false);
    } }
    async function signOut() { await removeToken(); setProfile(null); setLogged(false); setAttendance(null); }
    async function loadTeacherRoster(id) { try {
        const date = new Intl.DateTimeFormat('en-CA').format(new Date());
        const rows = await api(`/learning/attendance/classes/${id}/${date}`);
        setClassRows(rows.map(r => ({ ...r, selectedStatus: r.attendance?.status || null })));
    }
    catch (e) {
        setError(e.message);
    } }
    useEffect(() => { if (logged && profile?.role === 'teacher' && classId)
        loadTeacherRoster(classId); }, [logged, profile, classId]);
    async function saveAttendance() { const records = classRows.filter(r => r.selectedStatus).map(r => ({ studentId: r._id, status: r.selectedStatus })); if (!records.length) {
        setError('Choose an attendance status before saving.');
        return;
    } setSaving(true); setError(''); try {
        const date = new Intl.DateTimeFormat('en-CA').format(new Date());
        await api(`/learning/attendance/classes/${classId}/${date}`, { method: 'POST', body: JSON.stringify({ records }) });
        await loadTeacherRoster(classId);
    }
    catch (e) {
        setError(e.message);
    }
    finally {
        setSaving(false);
    } }
    async function updateSmsConsent(enabled) { try {
        const result = await api(`/sms/me/consent`, { method: `PUT`, body: JSON.stringify({ enabled }) });
        setSmsConsent(result.smsConsent);
    }
    catch (e) {
        setError(e.message);
    } }
    if (busy)
        return <View style={s.center}><ActivityIndicator color={C.moss}/><Text style={s.muted}>Opening your school…</Text></View>;
    if (!logged)
        return <ScrollView contentContainerStyle={s.loginPage}><View style={s.brandLine}><View style={s.logo}><Text style={s.logoText}>S</Text></View><Text style={s.brand}>Shikshly<Text style={{ color: C.moss }}>.</Text></Text></View><View style={s.eyebrow}><Text style={s.eyebrowText}>YOUR SCHOOL, CLOSE BY</Text></View><Text style={s.title}>A calmer school day{'\n'}starts here.</Text><Text style={s.subtitle}>Attendance, homework, and school updates in one thoughtful place.</Text><View style={s.loginCard}><Text style={s.cardTitle}>Welcome back</Text><Text style={s.cardSub}>Sign in to your school account.</Text><Text style={s.label}>Account type</Text><View style={s.roleRow}>{['member', 'applicant'].map(x => <Pressable key={x} onPress={() => setContext(x)} style={[s.rolePill, context === x && s.roleSelected]}><Text style={[s.roleText, context === x && s.roleTextSelected]}>{x === 'member' ? 'School member' : 'Applicant'}</Text></Pressable>)}</View><Text style={s.label}>Email address</Text><TextInput autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@school.org" style={s.input}/><Text style={s.label}>Password</Text><TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="Your password" style={s.input}/>{error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}<Pressable onPress={signIn} style={s.primary}><Text style={s.primaryText}>Sign in securely  →</Text></Pressable><Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${WEB_URL}/forgot-password`)} style={{ paddingVertical: 14, alignItems: 'center' }}><Text style={{ color: C.moss, fontWeight: '600' }}>Forgot your password?</Text></Pressable><Text style={s.smallText}>Use the web page to register a school or send an admission inquiry.</Text></View></ScrollView>;
    const role = profile?.role || 'member';
    return <ScrollView contentContainerStyle={s.page}><View style={s.topRow}><View style={s.brandLine}><View style={s.logo}><Text style={s.logoText}>S</Text></View><Text style={s.brand}>Shikshly<Text style={{ color: C.moss }}>.</Text></Text></View><Pressable onPress={signOut} style={s.signOut}><Text style={s.signOutText}>Sign out</Text></Pressable></View><View style={s.helloBlock}><View style={s.eyebrow}><Text style={s.eyebrowText}>{role.toUpperCase().replace('_', ' ')} VIEW</Text></View><Text style={s.titleSmall}>Hello, {profile?.user?.name?.split(' ')[0] || 'there'}.</Text><Text style={s.subtitle}>Here’s what’s happening at school.</Text></View>{error ? <Text style={s.error}>{error}</Text> : null}
    {['owner', 'principal'].includes(role) && attendance && <><View style={s.schoolBanner}><View><Text style={s.schoolTitle}>{attendance.school?.name || 'Your school'}</Text><Text style={s.muted}>{attendance.academicYear?.name || 'Current academic year'}</Text></View><Text style={s.schoolGlyph}>✦</Text></View><View style={s.statGrid}><Stat title="Students" value={attendance.cards.activeStudents} icon="◉"/><Stat title="Teachers" value={attendance.cards.teachers} icon="✎"/><Stat title="Families" value={attendance.cards.parents} icon="♡"/><Stat title="Open admissions" value={attendance.cards.openAdmissionInquiries} icon="↗"/></View><Section title="Attendance · last 30 days" subtitle="Whole school"><MiniBars days={attendance.graphs.attendance30Days}/></Section><Section title="Admissions" subtitle="Applications by stage"><View style={s.stageBox}>{attendance.graphs.admissionsByStatus.map((a) => <View key={a.status} style={s.stageRow}><Text style={s.stageText}>{a.status.replace('_', ' ')}</Text><Text style={s.stageNum}>{a.count}</Text></View>)}</View></Section><Section title="School at a glance" subtitle="Fees, library, and transport"><View style={s.metricLine}><Text style={s.metricLabel}>Fees collected</Text><Text style={s.metricValue}>{money(attendance.cards.feesCollectedPaise)}</Text></View><View style={s.metricLine}><Text style={s.metricLabel}>Library books</Text><Text style={s.metricValue}>{attendance.cards.libraryBooks}</Text></View><View style={s.metricLine}><Text style={s.metricLabel}>Active buses</Text><Text style={s.metricValue}>{attendance.cards.activeVehicles}</Text></View></Section></>}
    {['teacher', 'accountant', 'admission_staff', 'librarian'].includes(role) && <MobileInsights />}
    {role === 'parent' && <><Section title="Your children" subtitle="Choose a child"><View style={s.childRow}>{children.map(c => <Pressable key={c._id} onPress={() => setSelected(c._id)} style={[s.childPill, selected === c._id && s.childPillOn]}><Text style={[s.childText, selected === c._id && s.childTextOn]}>{c.name}</Text></Pressable>)}</View></Section>{attendance && <><Section title="Attendance" subtitle="Last 30 calendar days"><View style={s.attendanceHero}><View><Text style={s.attendancePct}>{attendance.summary.attendanceRate === null ? '—' : `${attendance.summary.attendanceRate}%`}</Text><Text style={s.attendanceDesc}>Present or late on marked school days</Text></View><View style={s.attendanceIcon}><Text style={{ fontSize: 25 }}>✳</Text></View></View><MiniBars days={attendance.days}/><View style={s.metricLine}><Text style={s.metricLabel}>Present · Absent · Not recorded</Text><Text style={s.metricValue}>{attendance.summary.present} · {attendance.summary.absent} · {attendance.summary.notRecorded}</Text></View><Text style={s.caption}>Not recorded days are not counted as absences.</Text></Section></>}<View style={{ marginTop: 20, padding: 14, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 14, flexDirection: `row`, alignItems: `center` }}><View style={{ flex: 1 }}><Text style={s.mobileStudent}>SMS absence alerts</Text><Text style={s.mobileAdmission}>Choose whether your school may text you.</Text></View><Switch value={smsConsent} onValueChange={updateSmsConsent} trackColor={{ false: `#dfe6de`, true: C.moss }}/></View></>}
    {role === 'teacher' && <Section title="Your classroom" subtitle="Only your assigned classes are shown"><View style={s.childRow}>{classes.map(c => <Pressable key={c._id} onPress={() => setClassId(c._id)} style={[s.childPill, classId === c._id && s.childPillOn]}><Text style={[s.childText, classId === c._id && s.childTextOn]}>{c.name} {c.section}</Text></Pressable>)}</View><View style={s.rosterCard}>{classRows.map(r => <View key={r._id} style={s.mobileRoster}><View style={{ flex: 1 }}><Text style={s.mobileStudent}>{r.name}</Text><Text style={s.mobileAdmission}>{r.admissionNo || 'Student'}</Text></View>{['present', 'absent', 'late'].map(status => <Pressable key={status} accessibilityRole="button" accessibilityLabel={`${status} for ${r.name}`} onPress={() => setClassRows(rows => rows.map(x => x._id === r._id ? { ...x, selectedStatus: status } : x))} style={[s.markPill, r.selectedStatus === status && s.markPillOn]}><Text style={[s.markText, r.selectedStatus === status && s.markTextOn]}>{status === 'present' ? 'P' : status === 'absent' ? 'A' : 'L'}</Text></Pressable>)}</View>)}{!classRows.length && <Text style={s.cardSub}>Select an assigned class to load its roster.</Text>}</View><Pressable disabled={saving || !classRows.length} onPress={saveAttendance} style={[s.primary, { opacity: saving ? 0.65 : 1 }]}><Text style={s.primaryText}>{saving ? 'Saving…' : "Save today's attendance"}</Text></Pressable></Section>}
    {role === 'student' && <Section title="Your school day" subtitle="Homework shared with your class">{homework.length ? homework.slice(0, 8).map(h => <View key={h._id} style={s.homeworkCard}><Text style={s.homeworkTitle}>{h.title}</Text><Text style={s.cardSub}>{h.instructions}</Text><Text style={s.homeworkDue}>Due {h.dueAt ? new Date(h.dueAt).toLocaleDateString() : "date not set"}</Text></View>) : <View style={s.infoCard}><Text style={s.infoIcon}>✦</Text><Text style={s.cardSub}>Homework and school updates will appear here when your teacher shares them.</Text></View>}</Section>}
    <View style={s.bottomNote}><Text style={s.bottomIcon}>✓</Text><Text style={s.bottomCopy}>Your account only sees the school and student information it has been linked to.</Text></View></ScrollView>;
}
function Section({ title, subtitle, children }) { return <View style={s.section}><View style={s.sectionHead}><View><Text style={s.sectionTitle}>{title}</Text><Text style={s.sectionSub}>{subtitle}</Text></View></View>{children}</View>; }
function Stat({ title, value, icon }) { return <View style={s.statCard}><Text style={s.statIcon}>{icon}</Text><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{title}</Text></View>; }
function MiniBars({ days }) { const recent = days.slice(-15); return <View style={s.chartCard}><View style={s.barChart}>{recent.map((d, i) => { const pct = d.attendanceRate ?? (d.status === 'present' ? 100 : d.status === 'late' ? 72 : d.status === 'absent' ? 18 : 8); return <View key={d.date || i} style={s.barCol}><View style={s.barRail}><View style={[s.barFill, { height: `${Math.max(7, pct)}%`, backgroundColor: d.status === 'absent' ? '#d88775' : d.status === 'not_recorded' ? '#dfe6de' : C.moss }]}/></View><Text style={s.barDay}>{String(d.date).slice(-2)}</Text></View>; })}</View><View style={s.chartLegend}><Text style={s.legendDot}>●</Text><Text style={s.caption}>School day attendance</Text></View></View>; }
function money(paise) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((paise || 0) / 100); }
const s = StyleSheet.create({ page: { padding: 22, paddingTop: 20, paddingBottom: 44 }, loginPage: { padding: 24, paddingTop: 52, paddingBottom: 50, flexGrow: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: C.cream }, brandLine: { flexDirection: 'row', alignItems: 'center', gap: 9 }, logo: { height: 34, width: 34, borderRadius: 12, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }, logoText: { color: '#fff', fontWeight: '800', fontSize: 17 }, brand: { fontSize: 17, fontWeight: '700', color: C.ink, letterSpacing: -.4 }, topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, signOut: { borderWidth: 1, borderColor: C.line, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 9 }, signOutText: { color: C.ink, fontWeight: '600', fontSize: 12 }, helloBlock: { marginTop: 34, marginBottom: 22 }, eyebrow: { alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 10, backgroundColor: '#e8eee8', borderRadius: 99, marginBottom: 12 }, eyebrowText: { color: C.moss, fontSize: 9, fontWeight: '800', letterSpacing: 1.3 }, title: { fontSize: 37, lineHeight: 43, fontWeight: '700', letterSpacing: -1.5, color: C.ink }, titleSmall: { fontSize: 32, fontWeight: '700', letterSpacing: -1, color: C.ink }, subtitle: { fontSize: 14, lineHeight: 21, color: C.muted, marginTop: 10 }, loginCard: { marginTop: 30, backgroundColor: C.white, borderRadius: 22, borderWidth: 1, borderColor: C.line, padding: 20 }, cardTitle: { fontSize: 19, fontWeight: '700', color: C.ink }, cardSub: { fontSize: 13, lineHeight: 19, color: C.muted, marginTop: 5 }, label: { fontSize: 12, fontWeight: '700', color: C.ink, marginTop: 16, marginBottom: 7 }, input: { height: 48, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 13, color: C.ink, backgroundColor: '#fbfcfa' }, roleRow: { flexDirection: 'row', gap: 8 }, rolePill: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 50, backgroundColor: '#f3f5f2' }, roleSelected: { backgroundColor: C.ink }, roleText: { fontSize: 11, color: C.muted, fontWeight: '600' }, roleTextSelected: { color: '#fff' }, primary: { backgroundColor: C.ink, borderRadius: 13, height: 50, alignItems: 'center', justifyContent: 'center', marginTop: 20 }, primaryText: { fontSize: 13, fontWeight: '700', color: '#fff' }, smallText: { fontSize: 10, color: C.muted, textAlign: 'center', lineHeight: 16, marginTop: 16 }, error: { color: '#a94635', fontSize: 12, marginTop: 11 }, schoolBanner: { backgroundColor: C.ink, borderRadius: 19, padding: 18, marginBottom: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, schoolTitle: { fontSize: 17, color: '#fff', fontWeight: '700' }, schoolGlyph: { fontSize: 25, color: '#e8bd7b' }, muted: { fontSize: 12, color: C.muted, marginTop: 4 }, statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 6 }, statCard: { width: '48%', flexGrow: 1, backgroundColor: C.white, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.line }, statIcon: { fontSize: 16, color: C.moss }, statValue: { fontSize: 24, fontWeight: '700', color: C.ink, marginTop: 8 }, statLabel: { fontSize: 11, color: C.muted, marginTop: 3 }, section: { marginTop: 22 }, sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }, sectionTitle: { fontSize: 18, fontWeight: '700', color: C.ink, letterSpacing: -.4 }, sectionSub: { fontSize: 11, color: C.muted, marginTop: 4 }, chartCard: { backgroundColor: C.white, borderRadius: 18, padding: 15, borderWidth: 1, borderColor: C.line }, barChart: { height: 115, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 5 }, barCol: { flex: 1, alignItems: 'center', gap: 7, height: '100%', justifyContent: 'flex-end' }, barRail: { width: '75%', height: '83%', justifyContent: 'flex-end', backgroundColor: '#f1f4f0', borderRadius: 7, overflow: 'hidden' }, barFill: { width: '100%', borderRadius: 7 }, barDay: { fontSize: 8, color: C.muted }, chartLegend: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 12 }, legendDot: { fontSize: 9, color: C.moss }, caption: { fontSize: 10, color: C.muted, marginTop: 7 }, attendanceHero: { backgroundColor: '#e8efe8', borderRadius: 18, padding: 17, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }, attendancePct: { fontSize: 34, fontWeight: '700', letterSpacing: -1, color: C.ink }, attendanceDesc: { fontSize: 10, color: C.muted, marginTop: 3 }, attendanceIcon: { height: 46, width: 46, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }, metricLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: C.line }, metricLabel: { flex: 1, color: C.muted, fontSize: 11 }, metricValue: { color: C.ink, fontSize: 11, fontWeight: '700' }, childRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' }, childPill: { backgroundColor: '#fff', borderRadius: 99, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14, paddingVertical: 10 }, childPillOn: { backgroundColor: C.ink, borderColor: C.ink }, childText: { fontSize: 12, color: C.ink, fontWeight: '600' }, childTextOn: { color: '#fff' }, stageBox: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 14 }, stageRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line }, stageText: { fontSize: 12, color: C.muted, textTransform: 'capitalize' }, stageNum: { fontSize: 13, fontWeight: '700', color: C.ink }, infoCard: { backgroundColor: C.white, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: C.line }, infoIcon: { fontSize: 20, color: C.moss, marginBottom: 8 }, rosterCard: { backgroundColor: C.white, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, marginTop: 12 }, mobileRoster: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 7, borderBottomWidth: 1, borderBottomColor: C.line }, mobileStudent: { fontSize: 12, fontWeight: '700', color: C.ink }, mobileAdmission: { fontSize: 9, color: C.muted, marginTop: 3 }, markPill: { height: 31, width: 31, borderRadius: 10, backgroundColor: '#f1f4f0', alignItems: 'center', justifyContent: 'center' }, markPillOn: { backgroundColor: C.moss }, markText: { fontSize: 10, fontWeight: '700', color: C.muted }, markTextOn: { color: '#fff' }, homeworkCard: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 14, marginTop: 8 }, homeworkTitle: { fontSize: 13, fontWeight: '700', color: C.ink }, homeworkDue: { fontSize: 10, fontWeight: '600', color: C.moss, marginTop: 9 }, bottomNote: { flexDirection: 'row', gap: 10, marginTop: 28, padding: 14, borderRadius: 14, backgroundColor: '#eaf0e9', alignItems: 'center' }, bottomIcon: { color: C.moss, fontSize: 15, fontWeight: '700' }, bottomCopy: { flex: 1, color: C.muted, fontSize: 10, lineHeight: 15 } });
