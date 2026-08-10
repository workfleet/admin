# Workfleet — Starter App

A working starter for a cleaning company CRM: cleaners check in to jobs, work through
a to-do list, upload photos, and clients log in to see the record. Includes a basic
admin rota page that assigns cleaners to jobs and automatically notifies them.

## What's included

- `supabase/schema.sql` — full database schema, roles, security rules, and the
  trigger that creates a notification when a cleaner is assigned a shift.
- `app/page.js` — login page, redirects by role (admin / cleaner / client).
- `app/cleaner/page.js` — cleaner's list of assigned jobs + their notifications.
- `app/cleaner/jobs/[id]/page.js` — check in/out, tick off tasks, upload photos.
- `app/client/page.js` — read-only portal: job history, tasks completed, photos.
- `app/admin/rota/page.js` — create jobs, assign a cleaner (this triggers the
  notification automatically — no extra code needed).

## 1. Set up Supabase (free)

1. Go to https://supabase.com and create a new project.
2. In your project, go to **SQL Editor → New query**, paste in the entire contents
   of `supabase/schema.sql`, and run it. This creates all your tables, security
   rules, and the auto-notification trigger.
3. Go to **Project Settings → API**. Copy your **Project URL** and **anon public key**.

## 2. Configure the app

1. Rename `.env.local.example` to `.env.local`.
2. Paste in your Supabase URL and anon key from the step above.

## 3. Install and run locally

You'll need Node.js installed (https://nodejs.org — get the LTS version).

```bash
npm install
npm run dev
```

Then open http://localhost:3000

## 4. Create your first users

The schema auto-creates every new sign-up as a `cleaner`. To make an admin or
client account:

1. In Supabase, go to **Authentication → Users → Add user** and create a user
   with an email/password.
2. Go to **Table Editor → profiles**, find that user's row, and change `role` to
   `admin` or `client`. If it's a client, also set `client_id` to match a row in
   the `clients` table (create one first under **Table Editor → clients**).

## 5. Add some test data

In the Supabase Table Editor, manually add:
- A row in `clients` (e.g. "Acme Offices")
- A row in `properties` linked to that client (e.g. "12 High Street")
- A row in `jobs` linking that property to a cleaner, with a `scheduled_at` time
- A few rows in `tasks` linked to that job (e.g. "Vacuum reception", "Empty bins")

Then log in as the cleaner to check in and complete the job, or as the client to
view the log.

## 6. What's next / not yet built

This is a working MVP skeleton, not a finished product. Natural next steps:

- **Email/push notifications**: right now, "notifications" are stored in the
  database and shown in-app only. To actually alert cleaners (email, SMS, or
  push), add a Supabase Edge Function that runs on the `notifications` table
  insert and calls an email service (e.g. Resend) or Twilio for SMS.
- **Admin: manage clients/properties/tasks from the UI** — right now these are
  added directly in the Supabase table editor; you'll want simple admin forms
  for these eventually.
- **Photo compression** before upload, for cleaners on mobile data.
- **Calendar-style rota view** instead of a flat list.
- **Deploy**: push this to GitHub, then connect the repo at https://vercel.com
  (free tier) and add the same environment variables there — it'll go live in
  a couple of minutes.

## Stack

- **Next.js** (React) — the app you see and click through
- **Supabase** — database, auth, file storage, and row-level security, all
  managed for you
