> **v1.4 runtime baseline:** Node.js 22.13+ is required.

# Publish Shikshly (step by step)

Total time: about 45 minutes the first time. Cost to start: free tiers are enough for a pilot.
You need three accounts: **MongoDB Atlas** (database), **Render** (hosts API + website), **Resend** (sends email).

## 0. Before every publish: one command
```bash
npm run verify
```
It runs the unit tests, builds the website, starts the API on a real database, loads demo data and runs ~100 end-to-end checks.
**Only publish when it ends with `✓ Everything passed`.** (CI runs the same command on every push, see `.github/workflows/ci.yml`.)

## 1. Database (MongoDB Atlas)
1. Create a free cluster at cloud.mongodb.com (choose a region near your users, e.g. Mumbai).
2. *Database Access* > add a user with a strong password. *Network Access* > allow `0.0.0.0/0` (Render IPs change).
3. *Connect* > *Drivers* > copy the `mongodb+srv://...` string and put the database name after the host: `.../shikshly?retryWrites=true&w=majority`.
4. Atlas M0 (free) supports transactions. Turn on **Backups** if you upgrade to a paid tier (M10+).

## 2. Email (Resend)
1. Sign up at resend.com, add and verify your domain (DNS records), create an API key.
2. Sender looks like `Shikshly <no-reply@your-domain.com>`.

## 3. API + website on Render
1. Push this project to GitHub.
2. Render > **New > Blueprint** > select the repo. It reads `render.yaml` and creates `shikshly-api` and `shikshly-web`.
3. Fill the values Render asks for:

| Variable | Value |
|---|---|
| `MONGO_URI` | the Atlas string from step 1 |
| `CORS_ORIGINS` and `APP_WEB_URL` | your website address, e.g. `https://shikshly-web.onrender.com` (https only, no trailing slash) |
| `RESEND_API_KEY`, `MAIL_FROM` | from step 2 |
| `VITE_API_URL` (website) | `https://shikshly-api.onrender.com/api` |
| Razorpay / MSG91 | leave empty until step 5 |

`JWT_SECRET` and `PLATFORM_ADMIN_BOOTSTRAP_SECRET` are generated for you. **Save the bootstrap secret** somewhere safe.
The API **refuses to start** if something unsafe is configured (weak secret, `http` origin, no email provider); the Render log then says exactly what to fix.

4. Wait for both to be green. Open `https://<api>/ready`: it must say `ready`.

## 4. First-time setup of the live system
1. Load plans (once): in Render's API *Shell* run `npm run seed:plans -w apps/api`.
2. **Set plan prices** (billing does not work until you do). One command, prices in rupees per student per month:
   `npm run plans:price -- basic=30 standard=50 premium=80 minimum=1500 trial=30`
   (basic/standard/premium = per student per month, minimum = least a school pays per month, trial = free-trial days). Safe to run again any time to change prices.
3. Create the one platform administrator with the bootstrap secret (see `docs/launch-readiness.md`).
4. Open the website, register a real test school, confirm the email link arrives, sign in.

## 5. Payments and SMS (when ready)
- **Razorpay**: keys from the dashboard. Add webhook `https://<api>/api/webhooks/razorpay`, secret = `RAZORPAY_WEBHOOK_SECRET`, events: `payment.captured`, `payment.failed`, and all `subscription.*`. Test in **Test mode first**: subscribe a school, pay with Razorpay's test card, watch the school's status change to `active`.
- **MSG91**: needs your DLT-approved template id (`MSG91_ATTENDANCE_TEMPLATE_ID`).

## 5b. Alerts and backups (10 minutes, both free, do not skip)
- **Alerts on your phone:** create a Discord or Slack channel > *Integrations > Webhooks* > copy the address into `ALERT_WEBHOOK_URL` on Render. From then on every server error and crash is posted there (the same problem at most once a minute).
- **Weekly backup:** GitHub repo > *Settings > Secrets and variables > Actions* > add `MONGO_URI` and `BACKUP_PASSPHRASE` (a long phrase you keep safe). `.github/workflows/backup.yml` then saves an **encrypted** copy every Sunday for 30 days (*Actions* tab > the run > *Artifacts*).
- **Practise a restore once** on a test database: `npm run restore -- --file <file>` shows what is inside, add `--confirm` to write it.

## 6. After publishing: stay error-free
| What | How | Time |
|---|---|---|
| Know when it is down | Free monitor (UptimeRobot / Better Stack) on `https://<api>/ready`, alert to your phone | 5 min |
| See errors | Render > API > *Logs*. Every request has an id; errors are logged in JSON | - |
| Safe updates | Merge to `main` only when CI is green; Render deploys automatically and keeps the old version until the new one passes `/ready` | - |
| Roll back | Render > API > *Deploys* > pick the last good one > *Rollback* | 1 min |
| Backups | Atlas backups (paid tier) or a weekly `mongodump`; **test a restore once** | 30 min |
| Cold starts | Render free tier sleeps; use the Starter plan for real schools | - |

## Known limits (be aware)
- Rate limiting is stored in the API's memory. Run **one** API instance, or add a Redis store before scaling out.
- Sessions last 8 hours; "Sign out" and password reset end them immediately. There is no refresh token yet, and the token lives in the browser's localStorage (standard for this kind of app, but a cookie-based session would be stricter).
- Switching plans means "Stop renewing" first, then subscribing to the new plan; there is no mid-cycle upgrade, no GST invoice generator and no refund screen (Razorpay emails receipts; refunds are done in the Razorpay dashboard).
- The admission-inquiry form still says "this email already has an account" for an existing email (needed so the person signs in instead). It is rate-limited (8 per 15 minutes per address).
- Razorpay billing and MSG91 SMS were written against their documentation but could not be exercised without real keys. Test them in sandbox (step 5) before charging anyone.
