// Forgot password, reset password and email confirmation screens.
// Each screen receives the shared page frame as `Layout` (App.jsx passes its AuthLayout), so the look stays consistent
// and this file does not import App.jsx.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { request } from '../api';

function useAction(fn) {
    const [state, setState] = useState({ busy: false, error: '', done: '' });
    const run = async (e) => {
        e?.preventDefault();
        setState({ busy: true, error: '', done: '' });
        try { setState({ busy: false, error: '', done: await fn() }); }
        catch (err) { setState({ busy: false, error: err.message, done: '' }); }
    };
    return [state, run];
}

export function ForgotPassword({ Layout }) {
    const [email, setEmail] = useState('');
    const [{ busy, error, done }, submit] = useAction(async () => (await request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })).message);
    return <Layout eyebrow="Account help" title={<>Forgot your <em>password?</em></>} subtitle="Enter your email and we will send you a link to choose a new one.">
        <form className="stack-form" onSubmit={submit}>
            <label>Email address<input required type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
            {error && <p className="error-line" role="alert">{error}</p>}
            {done && <p role="status">{done} Check your inbox (and spam folder).</p>}
            <button disabled={busy} className="button button-dark button-full">{busy ? 'Sending…' : 'Send reset link'}</button>
            <p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
        </form>
    </Layout>;
}

export function ResetPassword({ Layout }) {
    const [params] = useSearchParams();
    const [password, setPassword] = useState('');
    const [again, setAgain] = useState('');
    const [{ busy, error, done }, submit] = useAction(async () => {
        if (password !== again) throw new Error('The two passwords are not the same.');
        if (password.length < 10) throw new Error('Please use at least 10 characters.');
        return (await request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token: params.get('token') || '', password }) })).message;
    });
    return <Layout eyebrow="Account help" title={<>Choose a <em>new password.</em></>} subtitle="Use at least 10 characters. You will be signed out on all other devices.">
        <form className="stack-form" onSubmit={submit}>
            {!params.get('token') && <p className="error-line" role="alert">This link is incomplete. Please open the link from your email again.</p>}
            <label>New password<input required minLength={10} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
            <label>Type it again<input required minLength={10} type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} /></label>
            {error && <p className="error-line" role="alert">{error}</p>}
            {done && <p role="status">{done} <Link to="/login">Sign in</Link></p>}
            <button disabled={busy || !!done} className="button button-dark button-full">{busy ? 'Saving…' : 'Change password'}</button>
        </form>
    </Layout>;
}

export function VerifyEmail({ Layout }) {
    const [params] = useSearchParams();
    const [{ error, done }, run] = useAction(async () => (await request('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token: params.get('token') || '' }) })).message);
    useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
    return <Layout eyebrow="Email" title={<>Confirming your <em>email…</em></>} subtitle="One moment.">
        <div className="stack-form">
            {done && <p role="status">{done}</p>}
            {error && <p className="error-line" role="alert">{error}</p>}
            {!done && !error && <p>Checking your link…</p>}
            <Link className="button button-dark button-full" to="/login">Continue to sign in</Link>
        </div>
    </Layout>;
}
