# Architecture, plans, and release checklist

## Tenant boundaries

Each school has a school ID. A signed member session is bound to one school and one role; tenant models receive an automatic school scope in the request context, then role and plan guards limit actions. Public school discovery and applicants are cross-school by design but only expose public profile fields and an applicant's own inquiry/application data. Platform admin has explicit system-level routes. Keep school scoping on the server: frontend filters are never a security boundary.

Before real school data, commission a security review and automated adversarial tests for every query path, aggregate, webhook, report, export, file URL, and background job. Verify database indexes and backups, session invalidation, audit coverage, and school deletion/export behavior. Tenant scoping code is a foundation, not a certification.

## Plans represented in the starter

These are capability gates, based on the screenshot the founder supplied. INR price fields are intentionally unset. Ask a finance/legal advisor to determine taxes, renewal, cancellation, refund, and fair-use terms before charging schools.

| Capability | Free | Basic | Standard | Premium |
|---|---:|---:|---:|---:|
| Public school page / admission inquiries | Yes | Yes | Yes | Yes; featured listing |
| Photo cap | 5 | 30 | 100 | Unlimited |
| Students, teachers, parents, classes | — | Yes | Yes | Yes |
| Attendance, homework, exams, results | — | Yes | Yes | Yes |
| Notifications, messages, admission staff | — | Yes | Yes | Yes |
| Fees and online payment | — | — | Yes | Yes |
| Accountant and payroll approval | — | — | Yes | Yes |
| Library | — | — | Yes | Yes |
| Live bus GPS | — | — | — | Yes |
| Activity monitoring | — | Basic | Full | Full + export |
| SMS | — | Pay-per-pack | Small bundle | Larger bundle |

SMS allowances default to zero until the platform owner configures quotas and sells/purchases the corresponding credit bundles. Pricing fields are nullable. The platform API can update a plan; school subscription checkout, renewal, proration, invoices, refund/cancellation UI and automatic dunning are not complete.

## Current implementation boundaries

The API and web/mobile apps are a development starter. Several backend domains have endpoints and schemas, while the polished web UI mainly covers public discovery, registration/login/invite join, owner/principal analytics, parent 30-day attendance, teacher roster, and legal starter pages. Full owner CRUD screens, complete admission and fee workflows on mobile, full staff/student/parent portals, dedicated super-admin console, automated push/email delivery, and complete onboarding are still needed. Mobile is an Expo development app, not store-ready.

Additional release gaps:

- Authentication: browser prototype stores a bearer token in local storage; use a reviewed secure HttpOnly cookie/session flow for web, stronger owner/accountant authentication (2FA), rate limiting, password reset and recovery procedures.
- Tests: this package includes test scenarios but no automated test suite or security certification. Add unit, integration, API authorization, tenancy-isolation, web, and mobile tests; run CI with seeded disposable data.
- Payments: Razorpay fee-order/webhook building blocks exist, but verify payload signatures, idempotency, refund/dispute handling, gateway account setup, reconciliation reports and accounting before live money. Subscription billing remains a separate missing lifecycle.
- SMS: MSG91 Flow API adapter is optional/configurable. Indian DLT registration and approved templates are needed; provider acceptance is not a delivery receipt. Add delivery callbacks, retry/dead-letter strategy, consent audit, template versioning, and real credit purchase/usage accounting.
- Notifications: in-app records exist. Push/email/SMS provider setup, opt-outs, queues/retries, delivery logs and operational alerts are not complete.
- File handling: school photos are URL strings; add secure managed upload, malware/size/type checks, access controls, retention and image processing.
- Operations: configure managed Mongo with replica set, least-privilege credentials, encrypted transport/storage, backups with restore drills, monitoring, error reporting, incident response, data export/erasure/retention automation and disaster recovery.
- Privacy/legal: legal pages are starter copy, not lawyer-approved advice. Have qualified Indian counsel review DPDP roles, notices, parental consent, retention, processors, breach process, grievance handling and school contracts. Don't load real children's data until that review and safeguards are complete.
- Product: add Hindi/English translations, bulk import/export, parent messaging moderation/school-hour rules, invitation delivery/resend/revoke UI, activity export, support SLA process, and accessibility/device testing.
- Identity: choose a verified brand/domain, legal entity, support email, Android package and iOS bundle IDs before publishing. Store links/deep links are placeholders.

## Suggested delivery phases

1. **Local MVP:** establish tenant isolation tests; finish setup, invite, class roster, attendance, homework, parent dashboard, and public school profile flows.
2. **School operations:** fee ledger and payment reconciliation, exams/report cards, staff attendance/leave, payroll approvals, admissions, academic-year transitions, imports/exports.
3. **Paid platform:** plan billing, SMS credits and delivery callbacks, support, platform admin console, audits/usage limits, provider reconciliation.
4. **Mobile and transport:** push notifications, parent/student portals, app/universal links, live GPS permissions/retention, store build/review.
5. **Production controls:** legal/privacy signoff, penetration/security review, backup restore exercise, monitoring/on-call, migration/rollback plan, load test, accessibility and release checklist.

