# Shikshly (MERN): school management, school finder and admissions in one app

One MongoDB + Express + React (+ Expo mobile) project. The public website (find a school, ask about admission) and the school portals (owner, principal, teachers, accountant, librarian, drivers, parents, students) share one API and one database. Every school's data is isolated automatically.

> The whole project is **plain JavaScript** (Node.js + Express + MongoDB on the server, React on the website, React Native for the mobile app). No TypeScript, no build step for the API: `node src/index.js` runs it.

## The two commands you need most

```bash
npm run verify    # proves everything works (tests + build + ~100 end-to-end checks). Run before every publish.
```
Publishing: follow **[docs/DEPLOY.md](docs/DEPLOY.md)**. What it costs and the weekly routine: **[docs/RUNNING-COSTS.md](docs/RUNNING-COSTS.md)**. Understanding the code: **[docs/CODE-MAP.md](docs/CODE-MAP.md)**.

## Test it in 5 minutes (beginner path)

You need **Node 22.13+** and **Docker Desktop**. The mobile workspace follows Expo SDK 57, whose documented minimum Node line is 22.13.x.

```bash
npm install
npm run setup        # creates .env files with random secrets
npm run db:up        # starts MongoDB in Docker
npm run seed:demo    # creates demo schools + a login for every role
npm run dev          # API on :4000, website on :5173
```

Open http://localhost:5173 and sign in. **Password for every demo account: `Demo@12345!`**

| Role | Email | "Signing in as" |
|---|---|---|
| Owner | owner.a@demo.shikshly.test | School team |
| Principal | principal.a@demo.shikshly.test | School team |
| Admission staff | admission.a@demo.shikshly.test | School team |
| Accountant | accountant.a@demo.shikshly.test | School team |
| Teacher (Class 8-A) | teacher1.a@demo.shikshly.test | School team |
| Teacher (Class 8-B) | teacher2.a@demo.shikshly.test | School team |
| Librarian | librarian.a@demo.shikshly.test | School team |
| Bus driver | driver.a@demo.shikshly.test | School team |
| Parent (2 children) | parent1.a@demo.shikshly.test | School team / family |
| Parent (1 child) | parent2.a@demo.shikshly.test | School team / family |
| Student | student1.a@demo.shikshly.test | School team / family |
| Applicant | applicant@demo.shikshly.test | Admission applicant |
| Super admin | admin@demo.shikshly.test | Platform administrator |
| School B owner / teacher / parent | owner.b / teacher.b / parent.b @demo.shikshly.test | School team |

School A is on the **Premium** plan (everything on). School B is on **Basic** (no fees, library, transport) so you can see plan limits and prove the two schools can't see each other.

### One-command automatic test
With `npm run dev:api` running in another terminal:

```bash
npm run smoke        # re-creates demo data, then runs ~100 end-to-end checks
npm test             # fast unit tests (no database)
npm run check        # unit tests + production build of the website
```

`smoke` checks the important failures too: School B reading School A's data, one parent reading another parent's child, a teacher marking another class, a Basic school using Premium features, forged tokens, injection attempts, and the history rules below.

## History: who sees what

| Person | What they see | Where |
|---|---|---|
| **Super admin** | Every platform change (plan edits, subscriptions, suspending a school) with who/when/which school | `GET /api/platform/history?schoolId=&action=&from=&to=` |
| **Owner, principal** | All school activity (attendance, fees, admissions, exams, library, staff, invites...) with the person's name; plus sign-in history (device, time, no IP) | `GET /api/school/activity?action=&entity=&actorId=&from=&to=` and `GET /api/school/history/sign-ins` |
| **Parent** | One timeline per child: attendance, fee payments and receipts, homework, published exam results, notifications. Only sections the school's plan includes | `GET /api/learning/me/children/:studentId/history?days=90&types=` |
| **Student** | Same timeline, only for themself | same route |
| Teacher, accountant, others | No access to school-wide history | 403 |

History is append-only (no route edits or deletes it).

## What was fixed and upgraded
- **Converted to JavaScript** (API, website, mobile) with identical behaviour: the same 97 end-to-end checks and 19 unit tests pass, and website screenshots match the original.
- **Build blockers:** a syntax error stopped the website compiling; the mobile app pinned a non-existent Expo version.
- **Real bugs found by testing:** (1) members could not sign in at all (database queries ran outside the school scope); (2) saving any audit log, notification or payment failed validation; (3) the school guard did not cast ids in dashboard aggregates, so charts and fee totals were empty; (4) parents and students were blocked from listing their own children; (5) SMS sending crashed on a misspelled variable; (6) an invalid token returned 500 instead of 401.
- **Security:** hardened tenant isolation (also covers `insertMany`, `bulkWrite`, aggregates), JWT algorithm pinned, login timing no longer reveals which emails exist, rate limits on login/sign-up, helmet, strict CORS, env validation that refuses unsafe production settings, request IDs, secrets redacted from logs.
- **Reliability:** transactions through one helper, graceful shutdown, `/health` and `/ready`, expiring sessions, dashboard totals computed in MongoDB.
- **Frontend:** behaviour and markup untouched. All 40 KB of custom CSS is now Tailwind (`@apply` utilities; brand colours in `tailwind.config.js`; fonts loaded from `index.html`). Verified with pixel comparison: 13 of 15 screens identical, the rest under 0.02% (anti-aliasing).

## Security audit (`npm audit`)

Version 1.4 removes the fixable web build vulnerability path by moving the website from Tailwind CSS 3 to Tailwind CSS 4 with the official Vite integration, and pins the `shell-quote` override to the current patched release line. The remaining audit findings are upstream-only transitive issues in Expo/Metro tooling: `braces` currently has no patched release, and `node-forge` currently has no patched npm release for the September 2026 advisory. Do **not** use `npm audit fix --force`; it can make incompatible major-version changes.

Run:

```bash
npm run security:audit   # production/runtime dependency audit (recommended release gate)
npm run security:full    # full tree, including build/mobile tooling
```

The full-tree audit may still report upstream Expo/Metro findings until their maintainers publish compatible patched releases. This is documented rather than hidden. Re-run the audit before every release.

## Launch checklist (production)
1. **Database:** create a free/paid **MongoDB Atlas** cluster. Copy its connection string.
2. **API** (Render, Railway, Fly... uses `apps/api/Dockerfile`). Set: `NODE_ENV=production`, `MONGO_URI`, `JWT_SECRET` (48+ random chars), `PLATFORM_ADMIN_BOOTSTRAP_SECRET`, `CORS_ORIGINS=https://your-site`, `APP_WEB_URL=https://your-site`, `TRUST_PROXY=true`. The API refuses to start if any of these are unsafe, and prints why.
3. Run once: `npm run seed:plans -w apps/api` (creates the 4 plans; set prices in the super-admin panel).
4. **Website:** deploy `apps/web` as a static site (Vercel/Netlify/Cloudflare Pages). Build: `npm run build -w apps/web`, output `apps/web/dist`, env `VITE_API_URL=https://your-api/api`.
5. Create your super-admin account with the bootstrap route once, then remove `PLATFORM_ADMIN_BOOTSTRAP_SECRET`.
6. Turn on Atlas backups, and point an uptime monitor at `/health`.
7. **Do not run `seed:demo` in production** (it refuses unless forced).
8. Before real children's data: review the privacy page, get SMS template approval (MSG91) and Razorpay live keys + webhook.

## Version 1.4 security/build changes

- Tailwind CSS upgraded from v3 to v4.3.x using `@tailwindcss/vite`; the old PostCSS Tailwind configuration was removed.
- Legacy Tailwind directives were replaced with the v4 `@import "tailwindcss"` flow while retaining the existing JavaScript theme through `@config`.
- `shell-quote` is overridden to the current 1.12.x line.
- Node runtime baseline is documented as Node 22.13+.
- Added `security:audit` and `security:full` release checks.
- Added explicit documentation for vulnerabilities that currently have no upstream patch instead of applying unsafe forced downgrades.

## Not done yet (honest list)
- **Per-student pricing** (owner picks "100+ students" at sign-up and the plan price follows, with a student limit and online payment of the subscription) is designed but not built yet.
- Razorpay and MSG91 are coded but untested here (no keys). Test them in sandbox first.
- The history screens are API-only so far (you asked to keep the frontend untouched). The routes above are ready to wire into the dashboards.
- Mobile app: the code parses and was converted to JavaScript, but it was not run on a phone.
- Real-MongoDB run: I tested against a MongoDB-compatible stand-in with transactions off. Run `npm run smoke` once against the Docker database (transactions on) before launch.
