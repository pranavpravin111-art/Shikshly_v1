# Code map: where do I change things?

```
apps/api/            Node + Express + MongoDB (plain JavaScript, no build step)
  src/index.js         starts the server, connects to the database, shuts down cleanly
  src/app.js           builds the Express app: security headers, CORS, rate limits, mounts the routers
  src/config.js        reads + VALIDATES environment variables (refuses unsafe production settings)
  src/models.js        every database collection
  src/tenant-scope.js  makes sure a school can only ever read/write its own data (the most important file)
  src/middleware/auth.js  sign-in tokens, roles, "does this school's plan include this feature?"
  src/routes/          one file per area:
      auth.routes.js       sign-in, register, logout, password reset, email confirmation
      public.routes.js     school finder, admission inquiries/applications
      school.routes.js     the school's own data (students, fees, attendance, ...)
      billing.routes.js    school subscription (trial, subscribe, cancel)
      webhooks.routes.js   Razorpay callbacks (fee payments AND subscription changes)
      platform.routes.js   Shikshly's own admin (plans, schools, reviews)
      ...
  src/routes/insights.routes.js  the numbers behind each role's graphs (GET /api/insights; answer depends on the signed-in role)
  src/insights-utils.js  date helpers for graphs (IST months/days/weeks), unit-tested
  src/alerts.js        posts error alerts to a Slack/Discord webhook (ALERT_WEBHOOK_URL)
  src/billing-jobs.js  daily housekeeping inside the API process (expires unpaid subscriptions); no extra server needed
  src/backup-lib.js    backup file format (gzip + optional AES-256 encryption); used by scripts/backup.js and restore.js
  src/billing.js       PURE billing rules (price, trial, grace period). No database: easiest place to read/change pricing logic
  src/tokens.js        one-time email-link tokens (stored hashed)
  src/mailer.js        sends email (console in dev, Resend in production)
  src/auth-emails.js   the actual reset / confirmation emails
  src/razorpay.js      tiny Razorpay client
  scripts/seed-demo.js demo schools and users;   scripts/smoke.js  end-to-end checks
  tests/               fast unit tests (no database needed)
apps/web/            React website (Vite)
  src/pages/Billing.jsx   plan and billing screen (owner)
  src/pages/Insights.jsx  graphs for teacher / accountant / admission staff / librarian (recharts)
  src/pages/Billing.jsx   plan and billing screen (owner)
  src/pages/Insights.jsx  graphs for teacher / accountant / admission staff / librarian (recharts)
  src/App.jsx          main screens (large; new screens should go in src/pages/ like AccountRecovery.jsx)
  src/pages/           new screens, one file per feature (preferred place for new work)
  src/api.js           the one function every screen uses to call the API
apps/mobile/         Expo (React Native) app for parents/teachers/drivers (lib/MobileInsights.jsx = role graphs without a chart library)
scripts/verify.js    `npm run verify`: tests + build + end-to-end checks
```

## Rules that keep it safe (please keep following them)
1. **Never query school data without the tenant scope.** Use the existing models; do not use raw collections.
2. **Every new route needs `authenticate` + a role check**, and a "must NOT be allowed" check in `scripts/smoke.js`.
3. **Business rules go in small pure files** (like `billing.js`) with unit tests in `apps/api/tests/`.
4. **New environment variable?** Add it to `config.js` (validation), `.env.example` and `render.yaml`.
5. **New screens** go in `apps/web/src/pages/`. `App.jsx` is old and long; move things out of it gradually, never rewrite it all at once.
6. Before merging: `npm run verify`.

## Recipes
- *Change the free-trial length:* edit `trialDays` on the plan in the database. *Change grace period:* `GRACE_DAYS` in `billing.js`.
- *Add an email:* add a function in `auth-emails.js` using `sendMail`.
- *See the emails in development:* `apps/api/.mail-outbox.jsonl` (or the API log).
