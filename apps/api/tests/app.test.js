import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
const base = { NODE_ENV: 'test', MONGO_URI: 'mongodb://127.0.0.1:27017/unused', JWT_SECRET: 'x'.repeat(40), CORS_ORIGINS: 'http://localhost:5173' };
process.env.JWT_SECRET = base.JWT_SECRET; // the server reads it from the environment, as index.ts does
const app = createApp(buildConfig(base));
describe('API basics (no database needed)', () => {
    it('answers /health', async () => { const r = await request(app).get('/health'); expect(r.status).toBe(200); expect(r.body.status).toBe('ok'); });
    it('reports not-ready when the database is down', async () => { expect((await request(app).get('/ready')).status).toBe(503); });
    it('returns JSON 404 for unknown routes', async () => { const r = await request(app).get('/api/nope'); expect(r.status).toBe(404); expect(r.body.message).toBeTruthy(); });
    it('sets security headers and hides Express', async () => { const r = await request(app).get('/health'); expect(r.headers['x-powered-by']).toBeUndefined(); expect(r.headers['x-content-type-options']).toBe('nosniff'); });
    it('refuses unknown browser origins', async () => { expect((await request(app).get('/health').set('Origin', 'https://evil.example')).status).toBe(403); });
    it('allows the configured origin', async () => { expect((await request(app).get('/health').set('Origin', 'http://localhost:5173')).status).toBe(200); });
    it('requires a token on private routes', async () => { expect((await request(app).get('/api/school/students')).status).toBe(401); });
    it('rejects a garbage token with 401', async () => { expect((await request(app).get('/api/school/students').set('Authorization', 'Bearer nope')).status).toBe(401); });
    it('rejects NoSQL-injection login bodies', async () => { expect((await request(app).post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } })).status).toBe(400); });
    it('answers broken JSON with 400', async () => { expect((await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"a":')).status).toBe(400); });
    it('rejects a bad email on forgot-password before touching the database', async () => { expect((await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' })).status).toBe(400); });
    it('rejects a weak new password on reset-password', async () => { expect((await request(app).post('/api/auth/reset-password').send({ token: 'x'.repeat(43), password: 'short' })).status).toBe(400); });
    it('keeps billing private (needs sign-in)', async () => { expect((await request(app).get('/api/billing/status')).status).toBe(401); });
    it('refuses subscription webhooks that are not signed', async () => { const r = await request(app).post('/api/webhooks/razorpay').send({ event: 'subscription.charged' }); expect([401, 503]).toContain(r.status); });
    it('keeps graph data private (needs sign-in)', async () => { expect((await request(app).get('/api/insights')).status).toBe(401); });
});
