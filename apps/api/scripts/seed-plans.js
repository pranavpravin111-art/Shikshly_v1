import 'dotenv/config';
import mongoose from 'mongoose';
import { seedPlans } from '../src/seed/plans.js';
async function main() {
    if (!process.env.MONGO_URI)
        throw new Error('MONGO_URI is required (see apps/api/.env)');
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
    await seedPlans();
    console.log('Seeded the four school plans. Plans an admin already edited were preserved.');
    await mongoose.disconnect();
}
main().catch(async (error) => { console.error(error); await mongoose.disconnect(); process.exitCode = 1; });
