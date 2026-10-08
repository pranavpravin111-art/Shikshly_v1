import mongoose from 'mongoose';
let transactionsEnabled = true;
/** Called once at startup from the validated config. */
export function configureTransactions(enabled) { transactionsEnabled = enabled; }
/**
 * Runs `work` inside a MongoDB transaction (all writes succeed together or not at all).
 * `session` must be passed to every query inside `work`.
 *
 * If DB_TRANSACTIONS=false (local throw-away test databases only; refused in production)
 * `work` runs without a transaction and `session` is undefined, which Mongoose accepts.
 */
export async function inTransaction(work) {
    if (!transactionsEnabled)
        return work(undefined);
    const session = await mongoose.startSession();
    try {
        let result;
        await session.withTransaction(async () => { result = await work(session); });
        return result;
    }
    finally {
        await session.endSession();
    }
}
