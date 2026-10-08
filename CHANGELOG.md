# v1.3.0 — production UX hardening

- Added premium Settings workspace with persisted preferences, app rating, session management and password change flow.
- Added role-aware School Workspace for owner/principal staff management, invites, students and class/teacher assignment.
- Added a platform-admin control plane for schools, plans, support and audit history.
- Added Sonner feedback, Motion transitions, accessible focus states and reduced-motion support.
- Added authenticated password-change API that revokes other active sessions.

# Changelog

## 1.2.0: graphs for every role, billing screen, low-cost operation
- **Graphs:** teacher (7-day attendance per class), accountant (fees collected/pending, 6-month collection), admission staff (application stages, weekly inquiries), librarian (loans per month, overdue) on **web and mobile**. Backed by one new endpoint, `GET /api/insights`.
- **Billing screen** for the school owner (`/billing`): current plan and renewal, price for the school's student count, start trial / subscribe, stop renewing. `GET /api/billing/plans` added.
- **Email:** confirmation reminder banner with a resend button; reset/confirmation emails limited to one per minute per person; "Forgot your password?" link on the mobile sign-in.
- **Low running cost, low effort:** `npm run backup` / `restore` (encrypted) plus a free weekly GitHub backup workflow; error alerts to a Slack/Discord webhook; daily self-cleaning of unpaid subscriptions; Razorpay plans are reused instead of piling up; `npm run plans:price` sets prices in one line; `docs/RUNNING-COSTS.md` (what it costs and a 10-minute weekly routine).

## 1.1.0: production hardening
- **New:** forgot / reset password (hashed one-time links, 1 hour, single use, all sessions signed out afterwards, no account-existence leak).
- **New:** email confirmation (required before submitting an admission application in production).
- **New:** school subscription billing: `GET /api/billing/status`, `POST /api/billing/subscribe`, `POST /api/billing/cancel`; 30-day trial once per school; price = max(students x price, minimum); next month's amount follows the current student count.
- **New:** Razorpay subscription webhooks (activated, charged, pending/halted, cancelled, completed) with duplicate-delivery protection; a failed payment keeps a school working for a 3-day grace period.
- **Security:** school photo links must be `https://` and cannot contain characters that break out of CSS; process exits on an uncaught exception so the host restarts it; production refuses to start without a real email provider.
- **Quality:** `npm run verify` (one command: unit tests + build + ~100 end-to-end checks); CI now runs it on a real MongoDB replica set and builds the Docker image; more unit tests; `render.yaml` one-click deploy; SPA rewrites for Vercel/Netlify.
- **Docs:** `docs/DEPLOY.md`, `docs/CODE-MAP.md`.
