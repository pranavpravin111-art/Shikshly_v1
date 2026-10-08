import pino from 'pino';
/** One shared structured logger. Secrets and tokens are never written to logs. */
export const logger = pino({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-razorpay-signature"]', '*.password', '*.passwordHash'], censor: '[redacted]' },
});
