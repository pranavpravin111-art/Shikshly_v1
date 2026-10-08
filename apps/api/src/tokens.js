import { createHash, randomBytes } from 'node:crypto';

/**
 * One-time tokens for emailed links.
 * The plain token goes in the email; only its SHA-256 hash is stored, so a database leak cannot be used to reset passwords.
 */
export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

export function generateToken() {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: hashToken(token) };
}

export const TOKEN_LIFETIMES_MS = { password_reset: 60 * 60 * 1000, email_verify: 48 * 60 * 60 * 1000 };
