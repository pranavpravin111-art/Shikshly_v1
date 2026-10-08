import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { logger } from './logger.js';
import { authRouter } from './routes/auth.routes.js';
import { publicRouter, applicantRouter } from './routes/public.routes.js';
import { schoolRouter } from './routes/school.routes.js';
import { learningRouter } from './routes/learning.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { smsRouter } from './routes/sms.routes.js';
import { platformRouter } from './routes/platform.routes.js';
import { operationsRouter } from './routes/operations.routes.js';
import { webhookRouter } from './routes/webhooks.routes.js';
import { billingRouter } from './routes/billing.routes.js';
import { insightsRouter } from './routes/insights.routes.js';
import { notifyAlert } from './alerts.js';
/** Builds the Express app. It does not connect to the database or listen on a port, so tests can use it directly. */
export function createApp(config) {
    const app = express();
    app.disable('x-powered-by');
    if (config.trustProxy)
        app.set('trust proxy', 1);
    app.use(pinoHttp({
        logger,
        genReqId: (req, res) => {
            const id = String(req.headers['x-request-id'] || randomUUID()).slice(0, 64);
            res.setHeader('X-Request-Id', id);
            return id;
        },
        autoLogging: { ignore: req => ['/health', '/api/health', '/ready', '/api/ready'].includes(req.url || '') },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        serializers: { req: r => ({ id: r.id, method: r.method, url: String(r.url).split('?')[0] }), res: r => ({ statusCode: r.statusCode }) },
    }));
    app.use(helmet());
    app.use(compression());
    app.use(cors({
        origin(origin, callback) {
            if (!origin || config.corsOrigins.includes(origin))
                return callback(null, true);
            callback(Object.assign(new Error('Origin is not allowed by CORS'), { statusCode: 403 }));
        },
        credentials: true,
    }));
    // The raw body is only kept for payment webhooks, which need it for signature checks.
    app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { if (String(req.originalUrl).startsWith('/api/webhooks'))
            req.rawBody = Buffer.from(buf); } }));
    // ---- health checks (no login needed; used by hosting platforms and uptime monitors)
    const alive = (_req, res) => res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
    const ready = (_req, res) => {
        const connected = mongoose.connection.readyState === 1;
        res.status(connected ? 200 : 503).json({ status: connected ? 'ready' : 'database_unavailable', database: connected ? 'connected' : 'disconnected', transactions: config.dbTransactions });
    };
    app.get(['/health', '/api/health'], alive);
    app.get(['/ready', '/api/ready'], ready);
    // ---- rate limits: a general one, plus strict ones on the routes people attack (passwords, sign-ups)
    const tooMany = { message: 'Too many attempts. Please wait a few minutes and try again.' };
    app.use('/api', rateLimit({ windowMs: 60_000, limit: config.apiRateLimitMax, standardHeaders: true, legacyHeaders: false, skip: req => req.path.startsWith('/webhooks') }));
    app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: config.authRateLimitMax, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: tooMany }));
    for (const path of ['/api/auth/register-school', '/api/auth/join', '/api/auth/applicant/register', '/api/auth/platform/bootstrap', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/verify-email'])
        app.use(path, rateLimit({ windowMs: 15 * 60_000, limit: config.authRateLimitMax, standardHeaders: true, legacyHeaders: false, message: tooMany }));
    app.use('/api/auth', authRouter);
    app.use('/api/public', publicRouter);
    app.use('/api/applicant', applicantRouter);
    app.use('/api/school/dashboard', dashboardRouter); // must come before /api/school
    app.use('/api/school', schoolRouter);
    app.use('/api/learning', learningRouter);
    app.use('/api/sms', smsRouter);
    app.use('/api/platform', platformRouter);
    app.use('/api/operations', operationsRouter);
    app.use('/api/billing', billingRouter);
    app.use('/api/insights', insightsRouter);
    app.use('/api/webhooks', webhookRouter);
    app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));
    app.use((error, req, res, _next) => {
        if (error instanceof ZodError)
            return res.status(400).json({ message: 'Request validation failed', issues: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
        const e = error;
        if (e.code === 11000)
            return res.status(409).json({ message: 'A record with this value already exists' });
        if (e.name === 'CastError')
            return res.status(400).json({ message: 'One of the identifiers in the request is invalid' });
        const status = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
        if (status >= 500) {
            req.log?.error({ err: e }, 'Request failed');
            void notifyAlert(`Server error on ${req.method} ${String(req.originalUrl).split('?')[0]}: ${e.message} (request ${req.id})`);
        }
        return res.status(status).json({ message: status >= 500 ? 'Unexpected server error' : e.message || 'Request failed', ...(status >= 500 ? { requestId: String(req.id) } : {}) });
    });
    return app;
}
