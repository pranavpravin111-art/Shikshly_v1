import { describe, expect, it } from 'vitest';
import { buildConfig } from '../src/config.js';
const ok = { NODE_ENV: 'production', MONGO_URI: 'mongodb+srv://u:p@cluster.mongodb.net/db', JWT_SECRET: 'a'.repeat(48), CORS_ORIGINS: 'https://app.example.com', APP_WEB_URL: 'https://app.example.com', MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Shikshly <no-reply@example.com>' };
describe('environment validation', () => {
    it('accepts a safe production config', () => { expect(buildConfig(ok).isProduction).toBe(true); });
    it('rejects a short JWT secret', () => { expect(() => buildConfig({ ...ok, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/); });
    it('rejects the example placeholder secret in production', () => { expect(() => buildConfig({ ...ok, JWT_SECRET: 'replace-with-a-long-random-secret-value-123' })).toThrow(/placeholder/); });
    it('rejects wildcard CORS in production', () => { expect(() => buildConfig({ ...ok, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/); });
    it('rejects http origins in production', () => { expect(() => buildConfig({ ...ok, CORS_ORIGINS: 'http://app.example.com' })).toThrow(/https/); });
    it('rejects a local database in production', () => { expect(() => buildConfig({ ...ok, MONGO_URI: 'mongodb://127.0.0.1/db' })).toThrow(/Atlas/); });
    it('forbids disabling transactions in production', () => { expect(() => buildConfig({ ...ok, DB_TRANSACTIONS: 'false' })).toThrow(/DB_TRANSACTIONS/); });
    it('refuses production without a real email provider', () => { expect(() => buildConfig({ ...ok, MAIL_PROVIDER: 'console' })).toThrow(/Email is not configured/); });
    it('allows the console mailer in development', () => { expect(buildConfig({ NODE_ENV: 'development', MONGO_URI: 'mongodb://127.0.0.1/db', JWT_SECRET: 'a'.repeat(40) }).mailProvider).toBe('console'); });
    it('requires MONGO_URI', () => { expect(() => buildConfig({ NODE_ENV: 'development', JWT_SECRET: 'a'.repeat(40) })).toThrow(/MONGO_URI/); });
    it('uses PORT from hosting platforms when set', () => { expect(buildConfig({ ...ok, PORT: '8080' }).port).toBe(8080); });
});
