# Running Shikshly: what it costs and the 10-minute weekly routine

Written for the person who owns the product, not for a programmer. Prices change: check each company's pricing page before you commit.

## Monthly cost (starting out, a few schools)

| What | Service | Cost |
|---|---|---|
| Database | MongoDB Atlas **M0** (free, 512 MB, enough for several small schools) | Rs 0 |
| API (the server) | Render **Starter**, always on (about USD 7) | about Rs 600 |
| Website | Render static site, Vercel or Cloudflare Pages | Rs 0 |
| Email (password reset, confirmation) | Resend free plan (3,000 emails a month) | Rs 0 |
| Alerts to your phone | Discord or Slack webhook | Rs 0 |
| "Is it up?" monitor | UptimeRobot free | Rs 0 |
| Weekly encrypted backup | GitHub Actions (free allowance) | Rs 0 |
| Domain name | any registrar | about Rs 800 a **year** |
| Online fee payments | Razorpay takes a percentage of each payment (no monthly fee) | paid from the payment |
| SMS (only if schools switch it on) | MSG91, per SMS | per use |

**Total: about Rs 600 a month plus the domain**, until you have many schools. The free Render plan also works but the server **falls asleep** after 15 minutes without visitors and the next person waits about a minute; fine for a demo, not for real schools.

## What looks after itself
- Unpaid subscriptions are tidied automatically every few hours; schools whose plan ended lose paid features by themselves.
- Login sessions, password-reset links and email links expire on their own and are deleted from the database.
- Razorpay retrying a notification can never charge or mark something twice.
- If the server crashes the host restarts it; you get a message on your alert channel.
- A weekly encrypted backup is made for you (once you add the two GitHub secrets, see DEPLOY.md step 5b).

## Your weekly routine (10 minutes)
1. Open `https://<your api>/ready`: it must say `ready`.
2. Look at your alert channel: any errors this week? Forward repeated ones to your developer.
3. GitHub > *Actions* > *Weekly backup*: green tick? (A red one means the backup did not run: tell your developer.)
4. Razorpay dashboard: any failed or disputed payments? Schools with a failed subscription payment keep working for 3 days, then lose paid features.
5. Answer school support requests.

**Once a month:** practise a restore on a test database (30 minutes), and ask your developer to update the software packages.

## When something goes wrong
| What you see | Do this |
|---|---|
| Website says "cannot reach server" | Open `/ready`. If it does not answer, look at Render > API > *Logs* and press *Manual deploy > Restart*. If it says `database_unavailable`, check Atlas is not paused and `MONGO_URI` is correct. |
| Nobody gets reset or confirmation emails | Resend dashboard: is the domain still verified? Is the API key valid? Check the monthly email limit. |
| A school paid but still shows locked | Razorpay > Webhooks > find the `subscription.charged` event > *Resend*. It is safe to resend. |
| Something broke after an update | Render > API > *Deploys* > pick the last good one > *Rollback* (1 minute). |
| Data lost or damaged | Download the latest backup (GitHub > Actions > Artifacts) and follow `npm run restore` (see DEPLOY.md). |

## When to spend more
- Atlas storage above about 400 MB, or slow pages: upgrade Atlas (M10 is roughly USD 57 a month) and turn on its own backups.
- More than a few thousand emails a month: Resend paid plan (about USD 20).
- Running **more than one** API server: first move the rate limiter to Redis (ask your developer); until then keep one server.
