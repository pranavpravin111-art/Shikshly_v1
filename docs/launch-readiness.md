# Shikshly Launch Readiness

## What this release includes

- Multi-tenant school data isolation and role-based access.
- Public school discovery with distance search, profiles, admissions inquiry and application flows.
- Separate school ratings and Shikshly app ratings. School ratings remain school-scoped; app ratings are global and user-scoped.
- Account settings with persisted light/dark/system theme, English/Hindi preference, and notification preferences.
- Support tickets with threaded messages and audit events.
- Sign-in and school activity history endpoints.
- Subscription model fields for 30-day trial, per-active-student pricing, minimum monthly floor, renewal and provider IDs.
- Platform plan editor supports per-student price, minimum monthly price and trial days.
- Production security middleware, rate limiting, CORS restrictions, environment validation and Razorpay webhook signature verification already present in the API.

## Billing model

Recommended commercial rule:

`monthly charge = max(active student count × price per student, minimum monthly charge)`

Only students with `status=active` should be billable. The billable count should be snapshotted at the start of each billing period so mid-cycle student changes do not create surprise charges.

For the 30-day free trial, create a Razorpay subscription with the configured trial period and store the provider subscription ID. Never store card/UPI credentials in Shikshly. Treat Razorpay webhooks as the source of billing state and verify signatures server-side.

## External production gates

These cannot be safely fabricated inside a source ZIP and must be configured by the launch team:

1. MongoDB Atlas replica-set URI and backups.
2. HTTPS domain and production CORS origins.
3. Strong production JWT and platform bootstrap secrets.
4. MSG91 account, approved DLT entity/templates and production sender configuration.
5. Razorpay live account, subscription plans/recurring configuration, webhook secret and verified webhook URL.
6. Real legal entity, privacy/terms/refund/support contacts and DPDP/legal review.
7. Monitoring, error alerting, backup restore drill and DNS/SSL.
8. Store accounts and signed mobile builds if Android/iOS distribution is required.

## Pre-launch acceptance tests

- Create two schools; prove neither can read the other school's students, fees, SMS, reviews or support tickets.
- Register a school, start the trial, add/remove students and verify the billable snapshot.
- Complete a Razorpay test subscription, deliver a webhook twice, and confirm the second event is idempotently ignored.
- Force a failed recurring payment and verify `past_due`/grace-period UX.
- Send test SMS through MSG91, receive delivery/failed callbacks, and reconcile the SMS ledger.
- Submit a school review and an app review and verify the two aggregates never mix.
- Switch theme and language, reload, sign out/in, and verify preferences persist.
- Create a support ticket, reply, reopen/resolve it and verify the full thread and audit trail.
- Run API tests and a production web build before deployment.

## Important

A source package can be production-oriented and validated, but it is not safe to call the service fully live until the external production gates above are configured and the acceptance tests pass against the real providers.
