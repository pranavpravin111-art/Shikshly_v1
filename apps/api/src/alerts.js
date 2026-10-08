import { logger } from './logger.js';

/**
 * Sends a short message to your phone when something breaks (free: a Slack, Discord or Google Chat incoming webhook).
 * Set ALERT_WEBHOOK_URL to turn it on. The same problem is reported at most once a minute, so you never get spammed.
 */
const lastSent = new Map();

export async function notifyAlert(text, key = text.slice(0, 80), env = process.env) {
    const url = env.ALERT_WEBHOOK_URL;
    if (!url)
        return false;
    const now = Date.now();
    if (now - (lastSent.get(key) || 0) < 60_000)
        return false;
    if (lastSent.size > 200)
        lastSent.clear();
    lastSent.set(key, now);
    try {
        const message = `Shikshly: ${text}`.slice(0, 1800);
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: message, content: message }), signal: AbortSignal.timeout(5000) });
        return response.ok;
    }
    catch (error) {
        logger.warn({ err: error.message }, 'Could not send alert');
        return false;
    }
}
