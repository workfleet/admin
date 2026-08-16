-- "jobs: cleaner update own" (0009, redefined in 0030 for job_assignments)
-- let a cleaner UPDATE any column on a job they're assigned to, not just
-- the status transitions the app actually needs - and the app has never
-- called jobs.update() from the cleaner side at all (status is derived by
-- a trigger off checkins, per 0030). Live-tested: a cleaner's own session,
-- using nothing but the public anon key, could PATCH duration_minutes on
-- their own job directly - which flows straight into the payroll
-- calculation on the admin Dashboard. Since nothing legitimate depends on
-- this write, remove it rather than trying to carve out safe columns.
-- Cleaners keep read access via "jobs: cleaner own" - unaffected.

drop policy if exists "jobs: cleaner update own" on jobs;
