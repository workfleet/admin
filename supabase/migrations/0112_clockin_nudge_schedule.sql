-- Put the clock-in nudge on a clock of its own.
--
-- The sweep in app/api/admin/clockin-nudge has always been able to run. What
-- it has never had is anything to run it. It was written for a quarter-hourly
-- Vercel cron, that entry never stuck, and so it has fired only when an admin
-- happens to open the dashboard. A nudge that waits for someone in the office
-- to look at a screen is no nudge at all on the mornings it matters most: the
-- cleaner is in the building for two hours, nobody is at a desk, and by the
-- time anyone looks the shift is already in the missed pile and needs an
-- approval to put right.
--
-- So the schedule moves into the database, which is the one part of this
-- system that is awake whether or not anybody is. pg_cron fires every fifteen
-- minutes and pg_net posts to the same route, carrying the same CRON_SECRET
-- the Vercel crons already use. Nothing about the sweep itself changes - this
-- file adds a caller, not a rule.
--
-- Firing it often is safe by construction. The route stamps
-- jobs.clockin_nudge_sent_at and skips anything already stamped, so a cleaner
-- gets one buzz per shift no matter how many times this runs. That column was
-- put there for exactly this cron; it has just never had one until now.

-- ---------------------------------------------------------------------------
-- Where this lives, and why it is not in public
-- ---------------------------------------------------------------------------
-- PostgREST exposes every function in `public`, and Postgres grants EXECUTE on
-- new functions to PUBLIC, so a definer function in `public` is callable with
-- the anon key until something revokes it - that is how 0082's payroll helper
-- became a hole, fixed in 0087. This one reads the Vault secret that lets it
-- speak to our own API as a cron caller, so it must not be reachable at all.
-- A schema PostgREST does not serve is the belt; the revokes below are the
-- braces.
create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The caller
-- ---------------------------------------------------------------------------
-- The URL and the secret are deliberately NOT in this file and must never be:
-- this repo is public. They are read at call time from Supabase Vault, which
-- means applying this migration is only half the job - see the note at the
-- bottom for the two secrets that have to exist before it does anything.
--
-- `security definer` with `search_path = ''` is the usual pairing: the empty
-- path means every name below has to be schema-qualified, so nothing can be
-- shadowed by a table planted in a schema earlier on the caller's path.
create or replace function private.run_clockin_nudge()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  cron_secret text;
begin
  select decrypted_secret into base_url
    from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into cron_secret
    from vault.decrypted_secrets where name = 'cron_secret';

  -- Missing secrets are a setup mistake, not a runtime one, and the fix is in
  -- the dashboard rather than here. Warn and do nothing: raising would fill
  -- the cron history with failures every fifteen minutes and tell whoever
  -- eventually reads it nothing it does not already say once.
  if base_url is null or cron_secret is null then
    raise warning 'clock-in nudge: vault secrets app_base_url / cron_secret not set, skipping';
    return;
  end if;

  -- Fire and forget. pg_net queues the request and returns immediately, so a
  -- slow or down deployment cannot hold a cron worker open; the response is
  -- recorded in net._http_response either way, which is where to look when
  -- asking whether this has been working.
  perform net.http_post(
    url := base_url || '/api/admin/clockin-nudge',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

revoke all on function private.run_clockin_nudge() from public;
revoke all on function private.run_clockin_nudge() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- The schedule
-- ---------------------------------------------------------------------------
-- Guarded because CI replays this folder into a bare Postgres to prove the
-- repo can still rebuild its own database (scripts/replay-schema.sh), and that
-- container has never heard of pg_cron or pg_net. Stubbing them in the prelude
-- would be a lie - there is no honest thin shape for "run this every fifteen
-- minutes" - so the replay proves the function compiles and skips the
-- scheduling, and this comment is the note that the skipped half is only ever
-- exercised against a real Supabase project.
--
-- Everything inside is idempotent, so re-applying this file is harmless.
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron unavailable (replay/CI) - skipping clock-in nudge schedule';
    return;
  end if;

  execute 'create extension if not exists pg_cron';
  execute 'create extension if not exists pg_net';

  -- pg_net normally lands in its own `net` schema, which is what the function
  -- above calls into - but it can be installed into `extensions` instead, and
  -- if it already was then the "if not exists" above quietly did nothing and
  -- net.http_post does not resolve. That failure would otherwise show up as a
  -- cron job erroring every fifteen minutes with nobody watching, so it is
  -- caught here, at apply time, where somebody is.
  if not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'http_post' and n.nspname = 'net'
  ) then
    raise exception 'pg_net is not in the expected `net` schema - private.run_clockin_nudge() would fail at runtime. Check where http_post lives and fix the call before scheduling.';
  end if;

  -- Unschedule first so this file can be re-applied, and so changing the
  -- cadence is a one-line edit here rather than a hand-run command that no
  -- file in this repo describes.
  if exists (select 1 from cron.job where jobname = 'clockin-nudge') then
    perform cron.unschedule('clockin-nudge');
  end if;

  -- Every fifteen minutes, round the clock. Not office hours: the point of a
  -- nudge is to reach someone while they are still standing in the building,
  -- and an early shift that starts at six is exactly the one most likely to
  -- be forgotten. The route's own filters decide what deserves a buzz.
  perform cron.schedule(
    'clockin-nudge',
    '*/15 * * * *',
    $job$select private.run_clockin_nudge()$job$
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Before this does anything: two secrets and one env var
-- ---------------------------------------------------------------------------
-- 1. In Supabase, store the two secrets this reads. Run once, in the SQL
--    editor, with the real values - NOT in this file, and not in any file
--    committed here:
--
--      select vault.create_secret('https://crewconnect-cleaning.vercel.app', 'app_base_url');
--      select vault.create_secret('<the CRON_SECRET value>', 'cron_secret');
--
--    To change one later, use vault.update_secret(uuid, value) rather than
--    creating a second secret under the same name.
--
-- 2. CRON_SECRET must be set in the Vercel project, and the value above must
--    match it exactly. The route accepts either that secret or a signed-in
--    admin's session; with CRON_SECRET unset, every call from here gets a 401
--    and the nudge silently never sends.
--
-- Once both are in place, check it took:
--
--      select jobname, schedule, active from cron.job where jobname = 'clockin-nudge';
--      select status, count(*) from cron.job_run_details
--        where jobname = 'clockin-nudge' group by status;
--      select status_code, created from net._http_response order by created desc limit 5;
--
-- A first run picks up anything from the last 24 hours that was never nudged,
-- which after months without a working cron may be a handful of shifts at
-- once. Worth applying this during the working day so that backlog lands at a
-- civilised hour rather than at three in the morning.
