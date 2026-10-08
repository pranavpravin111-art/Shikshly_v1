// Plan and billing screen (school owner only). `Frame` is the page frame from App.jsx (menu + footer).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../api';

const rupees = (paise) => `₹${Math.round((paise || 0) / 100).toLocaleString('en-IN')}`;
const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATUS = { active: 'Active', trial: 'Free trial', past_due: 'Payment failed', cancelled: 'Cancelled', expired: 'Expired' };

export default function Billing({ Frame }) {
    const [status, setStatus] = useState(null);
    const [plans, setPlans] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const load = () => Promise.all([request('/billing/status'), request('/billing/plans')]).then(([s, p]) => { setStatus(s); setPlans(p); }).catch(e => setError(e.message));
    useEffect(() => { load(); }, []);

    const subscribe = async (key) => {
        setBusy(key); setError('');
        try {
            const r = await request('/billing/subscribe', { method: 'POST', body: JSON.stringify({ planKey: key }) });
            if (r.paymentLink) window.location.href = r.paymentLink; // Razorpay's secure page: the owner sets up autopay there
            else await load();
        } catch (e) { setError(e.message); }
        setBusy('');
    };
    const cancel = async () => {
        if (!window.confirm('Stop renewing? Your plan keeps working until the end of the period you already paid for.')) return;
        setBusy('cancel'); setError('');
        try { await request('/billing/cancel', { method: 'POST' }); await load(); } catch (e) { setError(e.message); }
        setBusy('');
    };

    const sub = status?.subscription;
    const subscribed = sub?.providerSubscriptionId && ['active', 'trial', 'past_due'].includes(sub.status) && !sub.cancelAtPeriodEnd;
    return <Frame>
        <p><Link to="/dashboard">← Back to dashboard</Link></p>
        <h1>Plan and billing</h1>
        {error && <p className="error-line" role="alert">{error}</p>}
        {!status || !plans ? (!error && <p>Loading…</p>) : <>
            <section className="insight-card">
                <h3>Your plan: {sub?.planKey ? sub.planKey[0].toUpperCase() + sub.planKey.slice(1) : 'Free'} <span className="pill">{STATUS[sub?.status] || 'Active'}</span></h3>
                <p>
                    {sub?.status === 'trial' && <>Free trial until <b>{date(sub.trialEnd)}</b>. </>}
                    {sub?.status === 'active' && sub?.periodEnd && <>{sub.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on <b>{date(sub.periodEnd)}</b>. </>}
                    {sub?.status === 'past_due' && <>Your last payment failed. Features stay on for a few days; please update your payment method with Razorpay. </>}
                    {['cancelled', 'expired'].includes(sub?.status) && <>Your paid plan has ended. Choose a plan below to continue. </>}
                    You have <b>{status.activeStudents}</b> active students. {status.nextChargePaise > 0 && <>Next monthly charge: <b>{rupees(status.nextChargePaise)}</b>.</>}
                </p>
                {subscribed && <button className="button" disabled={busy === 'cancel'} onClick={cancel}>Stop renewing</button>}
                {sub?.cancelAtPeriodEnd && <p><i>Renewal is switched off. Your plan ends on {date(sub.periodEnd)}.</i></p>}
            </section>
            <h2>Choose a plan</h2>
            <div className="plan-grid">
                {plans.plans.map(p => <section className="insight-card" key={p.key}>
                    <h3>{p.name}</h3>
                    <p>{p.description}</p>
                    {p.priced
                        ? <p><b>{rupees(p.estimatedMonthlyPaise)}</b> a month for {plans.activeStudents} students{p.pricePerStudentPaise ? ` (${rupees(p.pricePerStudentPaise)} per student${p.minimumMonthlyPaise ? `, minimum ${rupees(p.minimumMonthlyPaise)}` : ''})` : ''}. The price follows your student count each month.</p>
                        : <p><i>The price for this plan has not been set yet.</i></p>}
                    {p.trialDays > 0 && p.priced && <p>Includes a {p.trialDays}-day free trial.</p>}
                    <button className="button button-dark" disabled={!p.priced || p.current && subscribed || !!busy || subscribed} onClick={() => subscribe(p.key)}>
                        {p.current && subscribed ? 'Your current plan' : busy === p.key ? 'Opening payment page…' : p.trialDays > 0 ? 'Start free trial' : 'Subscribe'}
                    </button>
                </section>)}
            </div>
            {subscribed && <p><i>To switch plans, first choose “Stop renewing”, then pick the new plan when the period ends.</i></p>}
        </>}
    </Frame>;
}
