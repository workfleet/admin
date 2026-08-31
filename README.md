# WorkFleet

A cleaning company CRM: cleaners check in to jobs, work through a to-do list,
upload photos, and clients log in to see the record. Admins manage clients,
properties, the rota, and staff onboarding (ID collection + contract signing)
from the app itself.

## What's included

- `supabase/schema.sql` + `supabase/migrations/*.sql` — full database schema,
  roles, security rules, and the trigger that creates a notification when a
  cleaner is assigned a shift. Run `schema.sql` once, then every file in
  `migrations/` in order. See `supabase/migrations/README.md`.
- `app/page.js` — login/sign-up page, redirects by role (admin / cleaner / client).
- `app/cleaner/page.js` + `app/cleaner/jobs/[id]/page.js` — cleaner's jobs,
  check in/out, to-do list, photo upload.
- `app/client/page.js` — read-only portal: job history, tasks completed, photos.
- `app/admin/*` — Dashboard, Rota (calendar + to-do list management), Clients
  (profiles + properties), Cleaners (roster), Onboarding (invite links).
- `app/onboard/[token]/page.js` + `app/api/onboarding/*` — public, unauthenticated
  new-starter flow: personal details, ID upload, contract review & signature.

## 1. Set up Supabase (free)

1. Go to https://supabase.com and create a new project.
2. In your project, go to **SQL Editor → New query**, paste in the entire contents
   of `supabase/schema.sql`, and run it.
3. Then run every file in `supabase/migrations/` **in filename order** the same way.
4. Go to **Project Settings → API**. Copy your **Project URL**, **anon public key**,
   and **service_role key** (the last one is secret — never expose it to the browser).

## 2. Configure the app

Create `.env.local` with:

```
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

The last one has no `NEXT_PUBLIC_` prefix on purpose — it must only ever be
read on the server (see `lib/supabaseAdmin.js`), never in a `'use client'` file.

## 3. Install and run locally

```bash
npm install
npm run dev
```

Then open http://localhost:3000

## 4. Create your first admin

Sign up in the app (any email/password — every new sign-up starts as a
`cleaner`), then in Supabase go to **Table Editor → profiles**, find that
user's row, and change `role` to `admin`.

## 5. Add real data

Once logged in as admin, use the **Clients** page to add clients and
properties, the **Rota** to schedule jobs and add to-do tasks, and
**Onboarding** to generate invite links for new starters.

## Staff onboarding — important before real use

The contract text shown on `/onboard/[token]` is a **placeholder** — it is
not a legally reviewed contract. Replace `CONTRACT_TEXT` in
`app/onboard/[token]/page.js` with your actual employment contract (ACAS
provides free reviewed templates, or use a solicitor) before sending real
invite links.

The onboarding flow collects sensitive personal data (date of birth, home
address, National Insurance number, and an ID document photo). Before using
this for real staff:

- Decide and document a **data retention period** — how long you keep an
  ex-employee's ID photo and NI number after they leave.
- Show new starters what data is collected and why (a privacy notice) before
  they submit — see the note in `app/onboard/[token]/page.js`.
- If you want a legally certified right-to-work check rather than a manual
  in-person check, only a
  [GOV.UK-certified Identity Service Provider](https://www.gov.uk/government/publications/digital-identity-certification-for-right-to-work-right-to-rent-and-criminal-record-checks)
  counts for the statutory excuse — general KYC tools (e.g. Stripe Identity)
  do not.

This project stores ID documents in a **private** Supabase Storage bucket
(`staff-documents`), readable only by admins or the server's service-role
key — never via a public URL.

## Testing

### Unit tests

```bash
npm test
```

Covers the pure logic that decides money and time: the quote calculator
(`lib/quoteCalculator.js`), hours worked and holiday accrual
(`lib/hoursWorked.js`), staffed-contract shift patterns
(`lib/shiftSchedule.js`), automatic check-out (`lib/autoCheckout.js`), and the
local-date and reorder helpers. These are the files where a mistake reaches a
client's invoice or a cleaner's payslip, so they assert the *reasoning* -
that cost-plus pricing lands on the target margin, that the one-off minimums
do not apply to a contract visit, that a setting which cannot be read falls
back loudly instead of pricing labour at zero - rather than pinning today's
numbers.

`npm run test:watch` re-runs them as you edit.

### Can the database be rebuilt?

```bash
npm run test:schema
```

Compares the live database against `schema.sql` + `migrations/` in both
directions: columns added by hand in the dashboard that no file records, and
migrations that were never applied. Reads schema metadata only, never rows.
See `supabase/migrations/README.md`. CI additionally replays every file into
an empty Postgres on each push, which is the only real proof the schema can
be rebuilt from this repo.

### Error reporting

Set `NEXT_PUBLIC_SENTRY_DSN` to start receiving crash reports; leave it unset
and the SDK initialises and sends nothing, so nothing about the app changes.
`lib/sentryOptions.js` is where the redaction lives - request bodies,
cookies, headers, query strings and onboarding tokens are stripped, and
Session Replay is deliberately off, because the pages most worth debugging
are the ones showing someone's NI number. Optionally set `SENTRY_ORG`,
`SENTRY_PROJECT` and `SENTRY_AUTH_TOKEN` to upload source maps and get
readable stack traces.

### Security invariants

`scripts/rls-smoke-test.js` exercises the security invariants this project
has actually broken before (RLS recursion, cross-role data isolation, the
cleaner-deactivation gate, self privilege escalation). Run it after any RLS
or schema change:

```bash
TEST_ADMIN_EMAIL=you@example.com TEST_ADMIN_PASSWORD=yourpassword \
TEST_CLEANER_EMAIL=cleaner@example.com TEST_CLEANER_PASSWORD=theirpassword \
npm run test:rls
```

Admin credentials are required; cleaner credentials are optional (those
checks are skipped with a warning if omitted). It creates and cleans up its
own throwaway fixture data, so it's safe to run against a real project.

## 6. What's next / not yet built

- **Email/push/SMS notifications**: right now, "notifications" are stored in
  the database and shown in-app only. To actually alert cleaners, add a
  Supabase Edge Function on the `notifications` table insert that calls an
  email service (e.g. Resend) or SMS provider.
- **Real ID verification / e-signature integration**: the onboarding flow
  self-hosts a simple "type your name to sign" signature and manual ID photo
  upload. Swapping in a certified IDSP or a provider like Dropbox Sign/SignWell
  is possible but needs their API keys and your own provider decision.
- **Double-booking detection**, **photo compression before upload**, and
  **cleaner deactivation** — see open items tracked separately.
- **Invoicing** — client billing address exists in the schema, but there's no
  invoice generation yet.
- **Deploy**: push this to GitHub, then connect the repo at https://vercel.com
  (free tier) and add the same environment variables there (including the
  service role key, server-side only) — it'll go live in a couple of minutes.

## Stack

- **Next.js** (React) — the app you see and click through
- **Supabase** — database, auth, file storage, and row-level security
