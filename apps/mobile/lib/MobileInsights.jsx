// Simple graphs for teacher, accountant, admission staff and librarian on the phone (plain Views, no chart library to install).
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from './api';

const GREEN = '#1f6f5c', SOFT = '#e8f0ea', INK = '#172825', MUTED = '#7a8780', LINE = '#e2e9e2';
const rupees = (p) => `₹${Math.round((p || 0) / 100).toLocaleString('en-IN')}`;
const month = (m) => new Date(`${m}-01T00:00:00`).toLocaleString('en-IN', { month: 'short' });

const Card = ({ title, children }) => <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: LINE, borderRadius: 14, padding: 14, marginTop: 14 }}><Text style={{ fontWeight: '700', fontSize: 16, color: INK, marginBottom: 8 }}>{title}</Text>{children}</View>;
const Row = ({ name, value, max, text }) => <View style={{ marginVertical: 4 }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: INK }}>{name}</Text><Text style={{ color: MUTED }}>{text ?? value}</Text></View>
    <View style={{ height: 10, borderRadius: 5, backgroundColor: SOFT, marginTop: 3 }}><View style={{ height: 10, borderRadius: 5, backgroundColor: GREEN, width: `${Math.min(100, max ? (value / max) * 100 : 0)}%` }} /></View>
</View>;
const Big = ({ items }) => <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>{items.map(([n, v]) => <View key={n} style={{ backgroundColor: SOFT, borderRadius: 10, padding: 10, minWidth: 96 }}><Text style={{ fontSize: 20, fontWeight: '700', color: INK }}>{v}</Text><Text style={{ color: MUTED, fontSize: 12 }}>{n}</Text></View>)}</View>;

export default function MobileInsights() {
    const [d, setD] = useState(null);
    const [err, setErr] = useState('');
    useEffect(() => { api('/insights').then(setD).catch(e => setErr(e.message)); }, []);
    if (err) return <Text style={{ color: '#b42318', marginTop: 12 }}>{err}</Text>;
    if (!d) return <Text style={{ color: MUTED, marginTop: 12 }}>Loading your graphs…</Text>;
    if (d.kind === 'teacher')
        return d.classes.length ? d.classes.map(c => <Card key={c.id} title={`Class ${c.name}: last 7 days`}>
            <Big items={[['Students', c.students], ['Present today', c.today.present], ['Absent', c.today.absent], ['Not marked', c.today.notMarked]]} />
            {c.days.map(x => <Row key={x.date} name={x.date.slice(5)} value={x.rate ?? 0} max={100} text={x.rate === null ? 'not marked' : `${x.rate}%`} />)}
        </Card>) : <Text style={{ color: MUTED, marginTop: 12 }}>No class is assigned to you yet.</Text>;
    if (d.kind === 'accountant') {
        const top = Math.max(...d.monthly.map(m => m.amountPaise), 1);
        return <><Card title="Fees at a glance"><Big items={[['Collected', rupees(d.collectedPaise)], ['Pending', rupees(d.pendingPaise)], ['Overdue', rupees(d.overduePaise)]]} /></Card>
            <Card title="Collected, last 6 months">{d.monthly.map(m => <Row key={m.month} name={month(m.month)} value={m.amountPaise} max={top} text={rupees(m.amountPaise)} />)}</Card></>;
    }
    if (d.kind === 'admission_staff') {
        const top = Math.max(...d.weekly.map(w => w.count), 1), topS = Math.max(...d.byStatus.map(s => s.count), 1);
        return <><Card title="Applications by stage">{d.byStatus.length ? d.byStatus.map(s => <Row key={s.status} name={s.status.replace(/_/g, ' ')} value={s.count} max={topS} />) : <Text style={{ color: MUTED }}>No applications yet.</Text>}</Card>
            <Card title="New inquiries per week">{d.weekly.map(w => <Row key={w.weeksAgo} name={w.weeksAgo === 0 ? 'This week' : `${w.weeksAgo}w ago`} value={w.count} max={top} />)}</Card></>;
    }
    if (d.kind === 'librarian') {
        const top = Math.max(...d.monthly.map(m => Math.max(m.issued, m.returned)), 1);
        return <><Card title="Library at a glance"><Big items={[['Books', d.books], ['On loan', d.outstanding], ['Overdue', d.overdue]]} /></Card>
            <Card title="Issued per month">{d.monthly.map(m => <Row key={m.month} name={month(m.month)} value={m.issued} max={top} text={`${m.issued} out, ${m.returned} back`} />)}</Card></>;
    }
    return null;
}
