import { useEffect, useState } from 'react';
import { request } from '../api';

/** Shows a one-line reminder (with a resend button) until the signed-in person has confirmed their email. */
export default function VerifyBanner() {
    const [show, setShow] = useState(false);
    const [note, setNote] = useState('');
    useEffect(() => { request('/auth/me').then(d => setShow(d.emailVerified === false)).catch(() => { }); }, []);
    if (!show) return null;
    const resend = async () => { try { setNote((await request('/auth/resend-verification', { method: 'POST' })).message); } catch (e) { setNote(e.message); } };
    return <div className="notice-bar" role="status">
        <span>{note || 'Please confirm your email address. We sent you a link when you signed up.'}</span>
        {!note && <button type="button" className="button button-dark" onClick={resend}>Send the link again</button>}
    </div>;
}
