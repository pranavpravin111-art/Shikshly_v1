/**
 * Sets what each paid plan costs, in RUPEES (not paise). Billing refuses to start until prices are set.
 *   npm run plans:price -- basic=30 standard=50 premium=80 minimum=1500 trial=30
 * basic / standard / premium = price per student per month. minimum = least a school pays per month. trial = free trial days.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { Plan } from '../src/models.js';
import { seedPlans } from '../src/seed/plans.js';

async function main() {
    const given = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
    const num = (key) => { if (given[key] === undefined) return undefined; const v = Number(given[key]); if (!Number.isFinite(v) || v < 0) throw new Error(`"${key}" must be a number like ${key}=30`); return v; };
    const keys = ['basic', 'standard', 'premium'].filter(k => num(k) !== undefined);
    if (!keys.length)
        throw new Error('Example: npm run plans:price -- basic=30 standard=50 premium=80 minimum=1500 trial=30');
    if (!process.env.MONGO_URI)
        throw new Error('MONGO_URI is required (see apps/api/.env)');
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15_000 });
    await seedPlans();
    for (const key of keys) {
        const $set = { pricePerStudentPaise: Math.round(num(key) * 100) };
        if (num('minimum') !== undefined) $set.minimumMonthlyPaise = Math.round(num('minimum') * 100);
        if (num('trial') !== undefined) $set.trialDays = Math.round(num('trial'));
        await Plan.updateOne({ key }, { $set });
        console.log(`${key}: Rs ${num(key)} per student per month${$set.minimumMonthlyPaise !== undefined ? `, minimum Rs ${$set.minimumMonthlyPaise / 100}` : ''}${$set.trialDays !== undefined ? `, ${$set.trialDays}-day trial` : ''}`);
    }
    await mongoose.disconnect();
}
main().catch(async (error) => { console.error(`\n${error.message}\n`); await mongoose.disconnect().catch(() => undefined); process.exitCode = 1; });
