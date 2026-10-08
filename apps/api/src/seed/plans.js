import { Plan } from '../models.js';
/** The four subscription tiers. Prices are left unset on purpose: the platform admin sets them later. */
export const planRows = [
    { key: 'free', name: 'Free', description: 'Public school listing and admission inquiries.', monthlyPaise: null, annualPaise: null, pricePerStudentPaise: null, minimumMonthlyPaise: 0, trialDays: 30, features: ['public_page', 'admissions_inquiries'], limits: { photos: 5, students: 0, smsMonthly: 0, smsLabel: 'No SMS included' } },
    { key: 'basic', name: 'Basic', description: 'Core school operations for a small school.', monthlyPaise: null, annualPaise: null, pricePerStudentPaise: null, minimumMonthlyPaise: 0, trialDays: 30, features: ['public_page', 'admissions_inquiries', 'admissions', 'students', 'attendance', 'homework', 'exams', 'report_cards', 'notifications', 'messages', 'sms', 'activity.basic'], limits: { photos: 30, smsMonthly: 0, smsLabel: 'Pay per pack; configure allowance after setup' } },
    { key: 'standard', name: 'Standard', description: 'Core operations with fees, payroll and library.', monthlyPaise: null, annualPaise: null, pricePerStudentPaise: null, minimumMonthlyPaise: 0, trialDays: 30, features: ['public_page', 'admissions_inquiries', 'admissions', 'students', 'attendance', 'homework', 'exams', 'report_cards', 'notifications', 'messages', 'sms', 'fees', 'online_payment', 'payroll', 'library', 'activity.full'], limits: { photos: 100, smsMonthly: 0, smsLabel: 'Small bundle; set quantity in plan settings' } },
    { key: 'premium', name: 'Premium', description: 'Full school operations with transport and live GPS.', monthlyPaise: null, annualPaise: null, pricePerStudentPaise: null, minimumMonthlyPaise: 0, trialDays: 30, features: ['public_page', 'admissions_inquiries', 'admissions', 'students', 'attendance', 'homework', 'exams', 'report_cards', 'notifications', 'messages', 'sms', 'fees', 'online_payment', 'payroll', 'library', 'transport', 'live_gps', 'featured_listing', 'activity.full', 'activity.export'], limits: { photos: null, smsMonthly: 0, smsLabel: 'Larger bundle; set quantity in plan settings' } },
];
/** Inserts missing plans only. Plans an admin already edited are never overwritten. */
export async function seedPlans() {
    for (const row of planRows)
        await Plan.updateOne({ key: row.key }, { $setOnInsert: { ...row, available: true } }, { upsert: true });
}
