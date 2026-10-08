import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from '../src/tokens.js';
import { sendMail, OUTBOX_FILE } from '../src/mailer.js';
import { emailVerificationRequired } from '../src/auth-emails.js';
import { readFile, rm } from 'node:fs/promises';

describe('one-time tokens', () => {
    it('stores a hash, never the token itself', () => { const t = generateToken(); expect(t.tokenHash).toBe(hashToken(t.token)); expect(t.tokenHash).not.toContain(t.token); });
    it('are unique and long enough to be unguessable', () => { const a = generateToken(), b = generateToken(); expect(a.token).not.toBe(b.token); expect(a.token.length).toBeGreaterThanOrEqual(40); });
});

describe('email verification switch', () => {
    it('is on in production by default', () => { expect(emailVerificationRequired({ NODE_ENV: 'production' })).toBe(true); });
    it('is off in development by default', () => { expect(emailVerificationRequired({ NODE_ENV: 'development' })).toBe(false); });
    it('can be forced either way', () => { expect(emailVerificationRequired({ NODE_ENV: 'development', REQUIRE_EMAIL_VERIFICATION: 'true' })).toBe(true); expect(emailVerificationRequired({ NODE_ENV: 'production', REQUIRE_EMAIL_VERIFICATION: 'false' })).toBe(false); });
});

describe('console mailer (development)', () => {
    it('saves the email in the outbox so a developer or the smoke test can open the link', async () => {
        await rm(OUTBOX_FILE, { force: true });
        await sendMail({ to: 'a@b.test', subject: 'Hi', text: 'link' }, { NODE_ENV: 'test', MAIL_PROVIDER: 'console' });
        const row = JSON.parse((await readFile(OUTBOX_FILE, 'utf8')).trim().split('\n').pop());
        expect(row).toMatchObject({ to: 'a@b.test', subject: 'Hi', text: 'link' });
        await rm(OUTBOX_FILE, { force: true });
    });
});
