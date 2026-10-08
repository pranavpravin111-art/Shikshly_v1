import { Subscription } from './models.js';
import { runInScope } from './tenant-scope.js';
import { staleSubscriptionFilter } from './billing.js';
import { logger } from './logger.js';

/** Marks subscriptions nobody pays for as "expired". Safe to run any number of times. */
export async function expireStaleSubscriptions(now = new Date()) {
    const result = await runInScope({ system: true }, () => Subscription.updateMany(staleSubscriptionFilter(now), { $set: { status: 'expired' } }));
    if (result.modifiedCount)
        logger.info({ count: result.modifiedCount }, 'Expired unpaid subscriptions');
    return result.modifiedCount || 0;
}

/** Small jobs that run inside the API process, so there is no second server to pay for or look after. */
export function startBackgroundJobs() {
    const run = () => expireStaleSubscriptions().catch(error => logger.error({ err: error.message }, 'Background job failed'));
    setTimeout(run, 30_000).unref();
    setInterval(run, 6 * 60 * 60 * 1000).unref();
}
