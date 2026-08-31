-- Writes down a column the live database has had all along.
--
-- `jobs.duration_minutes` was added by hand in the Supabase dashboard and
-- never captured in a migration, so this repo could not rebuild its own
-- database: a brand-new project came up without the column and every insert
-- into `jobs` failed (PostgREST PGRST204). The app only worked because the
-- one database it points at happened to have a column the SQL history knew
-- nothing about.
--
-- Nothing about the live database changes here - `if not exists` makes this a
-- no-op there. It exists so a fresh project, a staging copy, or a restore
-- comes up with the same shape as production. `scripts/schema-drift-check.js`
-- now guards against this happening again.
--
-- 120 minutes matches the fallback the app already applies wherever the
-- column is read (`durationMinutes || 120` on the dashboard and rota), so a
-- rebuilt database agrees with the code rather than merely being non-null.
alter table jobs
  add column if not exists duration_minutes integer not null default 120;
