import { z } from 'zod';
const bool = (fallback) => z.preprocess(v => (v === undefined || v === '' ? fallback : String(v).toLowerCase() === 'true'), z.boolean());
const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Hosting platforms (Render, Railway, Heroku...) provide PORT; API_PORT is used locally.
    PORT: z.coerce.number().int().positive().optional(),
    API_PORT: z.coerce.number().int().positive().default(4000),
    MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must contain at least 32 characters'),
    PLATFORM_ADMIN_BOOTSTRAP_SECRET: z.string().optional().default(''),
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8081'),
    TRUST_PROXY: bool(false),
    APP_WEB_URL: z.string().default('http://localhost:5173'),
    APP_INSTALL_URL: z.string().optional().default(''),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    // Real transactions need a MongoDB replica set (Atlas always is one). Only turn this off
    // for throw-away local test databases that cannot do transactions.
    DB_TRANSACTIONS: bool(true),
    AUTO_INDEX: bool(true),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
    API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    MSG91_AUTH_KEY: z.string().optional().default(''),
    MSG91_ATTENDANCE_TEMPLATE_ID: z.string().optional().default(''),
    MSG91_FLOW_URL: z.string().optional().default('https://control.msg91.com/api/v5/flow'),
    RAZORPAY_KEY_ID: z.string().optional().default(''),
    RAZORPAY_KEY_SECRET: z.string().optional().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),
    // Optional: a Slack / Discord / Google Chat incoming-webhook address. The API posts a short message there when something breaks.
    ALERT_WEBHOOK_URL: z.string().optional().default(''),
    // Email (password reset, verification). "console" only prints emails; production needs "resend".
    MAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
    RESEND_API_KEY: z.string().optional().default(''),
    MAIL_FROM: z.string().optional().default(''),
    // Leave empty: on in production, off in development. Set true to test it locally.
    REQUIRE_EMAIL_VERIFICATION: z.string().optional().default(''),
});
const PLACEHOLDER = /replace-with|changeme|change-me|example|your[-_ ]?secret/i;
/** Validates the environment once, with plain-English errors. Throws on anything unsafe. */
export function buildConfig(env = process.env) {
    const parsed = schema.safeParse(env);
    if (!parsed.success) {
        const lines = parsed.error.issues.map(i => `  - ${i.path.join('.') || 'env'}: ${i.message}`);
        throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\nCopy apps/api/.env.example to apps/api/.env (or run "npm run setup") and fill it in.`);
    }
    const e = parsed.data;
    const origins = e.CORS_ORIGINS.split(',').map(x => x.trim()).filter(Boolean);
    const problems = [];
    if (e.NODE_ENV === 'production') {
        if (PLACEHOLDER.test(e.JWT_SECRET))
            problems.push('JWT_SECRET still looks like the example placeholder. Generate a random one (npm run setup does this).');
        if (e.PLATFORM_ADMIN_BOOTSTRAP_SECRET && PLACEHOLDER.test(e.PLATFORM_ADMIN_BOOTSTRAP_SECRET))
            problems.push('PLATFORM_ADMIN_BOOTSTRAP_SECRET still looks like the example placeholder.');
        if (!e.DB_TRANSACTIONS)
            problems.push('DB_TRANSACTIONS=false is not allowed in production (fee payments and admissions need real transactions).');
        if (origins.includes('*'))
            problems.push('CORS_ORIGINS must list your real website address, not "*".');
        if (origins.some(o => o.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(o)))
            problems.push('CORS_ORIGINS must use https:// in production.');
        if (!e.APP_WEB_URL.startsWith('https://'))
            problems.push('APP_WEB_URL must be your https:// website address in production (invite links use it).');
        if (e.MAIL_PROVIDER !== 'resend' || !e.RESEND_API_KEY || !e.MAIL_FROM)
            problems.push('Email is not configured: set MAIL_PROVIDER=resend, RESEND_API_KEY and MAIL_FROM (password reset cannot work without it).');
        if (/127\.0\.0\.1|localhost/.test(e.MONGO_URI))
            problems.push('MONGO_URI points at your own computer. Use MongoDB Atlas (or another managed replica set) in production.');
    }
    if (problems.length)
        throw new Error(`Unsafe production configuration:\n${problems.map(p => `  - ${p}`).join('\n')}`);
    return {
        env: e.NODE_ENV,
        isProduction: e.NODE_ENV === 'production',
        isTest: e.NODE_ENV === 'test',
        port: e.PORT ?? e.API_PORT,
        mongoUri: e.MONGO_URI,
        corsOrigins: origins,
        trustProxy: e.TRUST_PROXY,
        logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : e.NODE_ENV === 'production' ? 'info' : 'debug'),
        dbTransactions: e.DB_TRANSACTIONS,
        autoIndex: e.AUTO_INDEX,
        authRateLimitMax: e.AUTH_RATE_LIMIT_MAX,
        apiRateLimitMax: e.API_RATE_LIMIT_MAX,
        mailProvider: e.MAIL_PROVIDER,
    };
}
