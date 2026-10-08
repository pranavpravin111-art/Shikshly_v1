import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';

/**
 * Sends one email. Two providers, chosen with MAIL_PROVIDER:
 *   console  (default in development) prints the email in the API log and saves it in apps/api/.mail-outbox.jsonl,
 *            so you can click reset/verify links without any email account.
 *   resend   sends real email through https://resend.com (needs RESEND_API_KEY and MAIL_FROM).
 * Production refuses to start with "console" (see config.js).
 */
export const OUTBOX_FILE = fileURLToPath(new URL('../.mail-outbox.jsonl', import.meta.url));

export async function sendMail({ to, subject, text }, env = process.env) {
    const provider = env.MAIL_PROVIDER || 'console';
    if (provider === 'resend') {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok)
            throw new Error(`Email provider answered ${response.status}`);
        return { provider };
    }
    logger.info({ to, subject }, `[mail:console] ${text}`);
    if (env.NODE_ENV !== 'production')
        await appendFile(OUTBOX_FILE, `${JSON.stringify({ to, subject, text, at: new Date().toISOString() })}\n`).catch(() => undefined);
    return { provider: 'console' };
}
