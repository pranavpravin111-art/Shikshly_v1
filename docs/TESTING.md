> **v1.4 runtime baseline:** Node.js 22.13+ is required.

# How to test every role (beginner guide)

Password for every demo account: `Demo@12345!`. Sign in at http://localhost:5173/login.
Pick **"School team / family member"** for everyone below, except where noted. Leave "School ID" empty.
Reset everything any time with `npm run seed:demo`.

## Fastest way: use 2 browser profiles
Sessions are stored in the browser, so two roles in one window log each other out. Use a normal window plus a private (incognito) window, or two different browsers, to compare two roles side by side.

## The 10-minute full test (follow in order)

| # | Sign in as | Do this | You should see |
|---|---|---|---|
| 1 | **teacher1.a** (Teacher, Class 8-A) | Open attendance for Class 8-A, mark Aarav absent, save | 6 students; only Class 8-A is listed (not 8-B or Class 9) |
| 2 | **parent1.a** (Parent) | Open the dashboard | Two children (Aarav, Meera). Aarav shows absent today and a notification |
| 3 | **parent2.a** (Parent) | Open the dashboard | Only Kabir. Aarav and Meera must NOT appear |
| 4 | **student1.a** (Student) | Open the dashboard | Only Aarav's own data |
| 5 | **accountant.a** | Fees: pick Ishita Das, record a cash part-payment | Receipt number created, status becomes "partial" |
| 6 | **owner.a** (Owner) | Dashboard | Student count, fees collected/outstanding, attendance graph; school activity shows the teacher's attendance and the accountant's payment **with their names** |
| 7 | **principal.a** (Principal) | Dashboard and activity | Same school history as the owner. Cannot appoint another principal |
| 8 | **admission.a** | Admissions list, accept Rhea Applicant, admit to a class | A new student appears in the roster |
| 9 | **librarian.a** | Library: issue a book to a student | Loan appears; audit entry created |
| 10 | **driver.a** (Bus driver) | Transport | Only their own bus and route |
| 11 | **applicant@** (choose **Admission applicant**) | Open "My applications" | Rhea's application and its new status |
| 12 | **admin@** (choose **Platform administrator**) | Platform overview, change School B's plan | School list for the whole platform, and a history entry for the change |

## The "must NOT work" tests (the important ones)
Sign in as each person and try. All of these must be refused:

- **owner.b** (School B) opens any School A student: not found.
- **teacher2.a** marks attendance for Class 8-A: refused.
- **parent2.a** looks at Aarav's attendance or fees: not found.
- **teacher1.a** opens school history or the owner dashboard: refused.
- **owner.b** (Basic plan) opens Fees, Library or Transport: blocked with a "plan" message.
- **owner.a** opens the platform admin panel: refused.

## Automatic version of all of the above
With the API running (`npm run dev:api`), run `npm run smoke`. It creates fresh demo data and runs ~100 checks (every role, plus all the "must NOT work" cases) in about a minute and prints a ✓ or ✗ for each. Run it after every change you make.

## If a role cannot sign in
- "Email or password is incorrect": check the dropdown (applicant and platform admin use their own choices) and run `npm run seed:demo` again.
- The platform admin demo account is only created if no platform admin exists yet.


## New in 1.1: what to check by hand
Run `npm run verify` first; it already covers the automatic parts. Then, in the browser:
1. **Forgot password:** Login > "Forgot your password?" > enter `owner.a@demo.shikshly.test`. Open `apps/api/.mail-outbox.jsonl` (or the API log), copy the `reset-password?token=...` link, set a new password, sign in. Re-open the same link: it must say invalid. *(Reset the demo data afterwards: `npm run seed:demo`.)*
2. **Email confirmation:** start the API with `REQUIRE_EMAIL_VERIFICATION=true`, register a new applicant, try to submit an application: it must ask you to confirm your email; open the link from the outbox, try again: it works.
3. **Billing screens/API** (needs Razorpay *test* keys and plan prices set): as the owner call `POST /api/billing/subscribe`, open the returned `paymentLink`, pay with a Razorpay test card, and watch `GET /api/billing/status` change.
4. **Webhook retry:** in Razorpay's dashboard, resend a delivered `subscription.charged` event: the second delivery must answer `duplicate: true` and change nothing.

## New in 1.2: what to check by hand
1. **Graphs (web):** sign in as `teacher1.a`, `accountant.a`, `admission.a`, `librarian.a` (all `Demo@12345!`): each dashboard shows its own graphs. Mark attendance as the teacher, refresh: today's point appears. Collect a fee as the accountant, refresh: the bar and totals change.
2. **Graphs (mobile):** same four logins in the Expo app.
3. **Billing screen:** sign in as `owner.a`, press "Plan and billing". Plans show "The price for this plan has not been set yet" until you run `npm run plans:price -- basic=30 standard=50 premium=80`; after that the screen shows the price for the demo school's students. With Razorpay *test* keys, "Start free trial" opens Razorpay's page.
4. **Email banner:** start the API with `REQUIRE_EMAIL_VERIFICATION=true`, register a school, open the dashboard: the yellow banner appears; click the link from `.mail-outbox.jsonl`, reload: it is gone.
5. **Backup:** `npm run backup`, then `npm run restore -- --file apps/api/backups/<file>.bak` (dry run). Add `BACKUP_PASSPHRASE=abc` first to try the encrypted form.

## Security checks

```bash
npm run security:audit
npm run security:full
```
