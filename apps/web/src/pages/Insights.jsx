// Graphs for teacher, accountant, admission staff and librarian (owner, principal and parent have their own on the dashboard).
// Data comes from GET /api/insights, which already knows who is signed in.
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { request } from '../api';

const GREEN = '#1f6f5c', GOLD = '#f2b705', RED = '#b42318', GREY = '#8fa09a';
const rupees = (paise) => `₹${Math.round((paise || 0) / 100).toLocaleString('en-IN')}`;
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleString('en-IN', { month: 'short' });
const label = (s) => String(s).replace(/_/g, ' ');

const Card = ({ title, sub, children }) => <section className="insight-card"><h3>{title}</h3>{sub && <p className="insight-sub">{sub}</p>}{children}</section>;
const Chart = ({ children }) => <div style={{ width: '100%', height: 230 }}><ResponsiveContainer>{children}</ResponsiveContainer></div>;
const Stats = ({ items }) => <div className="insight-stats">{items.map(([name, value]) => <div key={name}><b>{value}</b><span>{name}</span></div>)}</div>;
const Empty = ({ children }) => <p className="insight-sub">{children}</p>;

function Teacher({ data }) {
    if (!data.classes.length) return <Empty>No class is assigned to you yet. Ask your principal to add you to a class.</Empty>;
    return data.classes.map(c => <Card key={c.id} title={`Class ${c.name}: last 7 days`} sub="Share of students present each day. A gap means attendance was not marked that day.">
        <Stats items={[['Students', c.students], ['Present today', c.today.present], ['Absent today', c.today.absent], ['Not marked yet', c.today.notMarked]]} />
        <Chart><LineChart data={c.days.map(d => ({ day: d.date.slice(5), rate: d.rate }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="day" /><YAxis domain={[0, 100]} unit="%" /><Tooltip formatter={v => `${v}%`} /><Line type="monotone" dataKey="rate" name="Present" stroke={GREEN} strokeWidth={3} connectNulls /></LineChart></Chart>
    </Card>);
}
function Accountant({ data }) {
    const total = data.collectedPaise + data.pendingPaise;
    return <>
        <Card title="Fees at a glance"><Stats items={[['Collected', rupees(data.collectedPaise)], ['Still pending', rupees(data.pendingPaise)], ['Overdue', rupees(data.overduePaise)]]} />
            {total > 0 ? <Chart><PieChart><Pie data={[{ name: 'Collected', value: data.collectedPaise }, { name: 'Pending', value: data.pendingPaise }]} dataKey="value" innerRadius={55} outerRadius={85}><Cell fill={GREEN} /><Cell fill={GOLD} /></Pie><Tooltip formatter={v => rupees(v)} /><Legend /></PieChart></Chart> : <Empty>No fee charges yet.</Empty>}</Card>
        <Card title="Money collected, last 6 months"><Chart><BarChart data={data.monthly.map(m => ({ month: monthName(m.month), amount: Math.round(m.amountPaise / 100) }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis tickFormatter={v => `₹${v >= 1000 ? `${v / 1000}k` : v}`} /><Tooltip formatter={v => `₹${v.toLocaleString('en-IN')}`} /><Bar dataKey="amount" name="Collected" fill={GREEN} radius={[6, 6, 0, 0]} /></BarChart></Chart></Card>
    </>;
}
function Admission({ data }) {
    return <>
        <Card title="Applications by stage" sub={`${data.totalApplications} applications in total`}>{data.byStatus.length ? <Chart><BarChart data={data.byStatus.map(s => ({ stage: label(s.status), count: s.count }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="stage" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="Applications" fill={GREEN} radius={[6, 6, 0, 0]} /></BarChart></Chart> : <Empty>No applications yet.</Empty>}</Card>
        <Card title="New inquiries per week" sub="Last 8 weeks"><Chart><LineChart data={data.weekly.map(w => ({ week: w.weeksAgo === 0 ? 'This week' : `${w.weeksAgo}w ago`, count: w.count }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="week" /><YAxis allowDecimals={false} /><Tooltip /><Line type="monotone" dataKey="count" name="Inquiries" stroke={GREEN} strokeWidth={3} /></LineChart></Chart></Card>
    </>;
}
function Librarian({ data }) {
    return <>
        <Card title="Library at a glance"><Stats items={[['Books', data.books], ['Out on loan', data.outstanding], ['Overdue', data.overdue]]} /></Card>
        <Card title="Books issued and returned" sub="Last 6 months"><Chart><BarChart data={data.monthly.map(m => ({ month: monthName(m.month), issued: m.issued, returned: m.returned }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Bar dataKey="issued" name="Issued" fill={GREEN} radius={[6, 6, 0, 0]} /><Bar dataKey="returned" name="Returned" fill={GREY} radius={[6, 6, 0, 0]} /></BarChart></Chart></Card>
    </>;
}
const VIEWS = { teacher: Teacher, accountant: Accountant, admission_staff: Admission, librarian: Librarian };

export default function Insights() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    useEffect(() => { request('/insights').then(setData).catch(e => setError(e.message)); }, []);
    if (error) return <p className="error-line" role="alert">{error}</p>;
    if (!data) return <p className="insight-sub">Loading your graphs…</p>;
    const View = VIEWS[data.kind];
    if (!View) return <Empty>There is nothing to graph for this role yet. Your daily work is in the mobile app.</Empty>;
    return <div className="insight-grid"><View data={data} /></div>;
}
