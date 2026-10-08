import 'dotenv/config';
import mongoose from 'mongoose';
import { buildConfig } from './config.js';
import { configureTransactions } from './db.js';
import { createApp } from './app.js';
import { logger } from './logger.js';
import { notifyAlert } from './alerts.js';
import { startBackgroundJobs } from './billing-jobs.js';
async function main() {
    const config = buildConfig();
    configureTransactions(config.dbTransactions);
    mongoose.set('autoIndex', config.autoIndex);
    const app = createApp(config);
    try {
        await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000, maxPoolSize: 20 });
    }
    catch (error) {
        logger.fatal({ err: error.message }, 'Could not connect to MongoDB. Local development: is Docker running? Try "npm run db:up". Production: check MONGO_URI and the Atlas network access list.');
        process.exit(1);
    }
    mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
    mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
    const server = app.listen(config.port, '0.0.0.0', () => logger.info({ port: config.port, env: config.env, transactions: config.dbTransactions }, 'Shikshly API listening'));
    // Longer than typical load-balancer idle timeouts, so connections are not cut mid-request.
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;
    startBackgroundJobs();
    if (config.isProduction && !process.env.ALERT_WEBHOOK_URL)
        logger.warn('ALERT_WEBHOOK_URL is not set: nobody will be told when the server has an error. See docs/RUNNING-COSTS.md.');
    let closing = false;
    const shutdown = (signal) => {
        if (closing)
            return;
        closing = true;
        logger.info({ signal }, 'Shutting down');
        const force = setTimeout(() => process.exit(1), 10_000);
        force.unref();
        server.close(async () => { await mongoose.disconnect().catch(() => undefined); process.exit(0); });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('unhandledRejection', reason => { logger.error({ err: reason }, 'Unhandled promise rejection'); void notifyAlert(`Unhandled error: ${reason?.message || reason}`); });
    // A truly unexpected crash: log it, then exit so the host (Render, Docker, ...) restarts a clean process.
    process.on('uncaughtException', error => { logger.fatal({ err: error }, 'Uncaught exception'); notifyAlert(`The server crashed and is restarting: ${error.message}`, 'crash').finally(() => process.exit(1)); setTimeout(() => process.exit(1), 6000).unref(); });
}
main().catch(error => {
    // Configuration problems are printed plainly so a beginner can read them.
    console.error(`\n${error.message}\n`);
    process.exit(1);
});
