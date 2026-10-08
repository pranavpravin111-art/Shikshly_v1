import { AuthToken, User } from './models.js';
import { generateToken, hashToken, TOKEN_LIFETIMES_MS } from './tokens.js';
import { sendMail } from './mailer.js';
import { logger } from './logger.js';

const webBase = () => (process.env.APP_WEB_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Email verification is enforced in production (set REQUIRE_EMAIL_VERIFICATION=false to turn it off, =true to test it locally). */
export function emailVerificationRequired(env = process.env) {
    const v = String(env.REQUIRE_EMAIL_VERIFICATION ?? '').toLowerCase();
    return v === '' ? env.NODE_ENV === 'production' : v === 'true';
}

/** Returns null when a link was already sent less than a minute ago, so nobody can flood an inbox with emails. */
async function issue(userId, purpose) {
    if (await AuthToken.exists({ userId, purpose, usedAt: null, createdAt: { $gt: new Date(Date.now() - 60_000) } }))
        return null;
    // Only the newest link works: older unused links of the same kind are removed first.
    await AuthToken.deleteMany({ userId, purpose, usedAt: null });
    const { token, tokenHash } = generateToken();
    await AuthToken.create({ userId, purpose, tokenHash, expiresAt: new Date(Date.now() + TOKEN_LIFETIMES_MS[purpose]) });
    return token;
}

/** Never throws: a broken email provider must not break sign-up. Failures are logged. */
export async function sendVerificationEmail(user) {
    try {
        if (user.emailVerifiedAt)
            return;
        const token = await issue(user._id, 'email_verify');
        if (!token)
            return;
        await sendMail({ to: user.email, subject: 'Confirm your email for Shikshly', text: `Hello ${user.name},\n\nPlease confirm your email address:\n${webBase()}/verify-email?token=${token}\n\nThis link works for 48 hours. If you did not create a Shikshly account, ignore this email.` });
    }
    catch (error) {
        logger.error({ err: error.message }, 'Could not send verification email');
    }
}

export async function sendPasswordResetEmail(user) {
    try {
        const token = await issue(user._id, 'password_reset');
        if (!token)
            return;
        logger.info({ userId: String(user._id) }, 'Password reset link issued');
        await sendMail({ to: user.email, subject: 'Reset your Shikshly password', text: `Hello ${user.name},\n\nUse this link to choose a new password:\n${webBase()}/reset-password?token=${token}\n\nThis link works for 1 hour and only once. If you did not ask for this, ignore this email; your password has not changed.` });
    }
    catch (error) {
        logger.error({ err: error.message }, 'Could not send password reset email');
    }
}

/** Uses a one-time token. Returns the user id, or null if the token is wrong, expired or already used. */
export async function consumeToken(token, purpose) {
    const row = await AuthToken.findOneAndUpdate({ tokenHash: hashToken(token), purpose, usedAt: null, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } });
    return row ? row.userId : null;
}

export const findActiveUserByEmail = (email) => User.findOne({ email: String(email).toLowerCase(), status: 'active' });
