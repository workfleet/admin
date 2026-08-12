-- Recurring jobs: occurrences are generated upfront as individual `jobs`
-- rows sharing a series_id, rather than computed live from a recurrence
-- rule - this project has no scheduled-job/cron infrastructure (see
-- lib/notifications.js's comment on why notification cleanup is lazy
-- rather than scheduled), so a rule engine that generates jobs over time
-- isn't an option here. Editing or deleting one occurrence just works on
-- that one job row like any other job - there's no live link to a rule
-- to "detach" from, since each occurrence was already an independent row
-- from the moment it was created.
create table job_series (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  duration_minutes integer not null,
  recurrence_type text not null check (recurrence_type in ('daily', 'weekly', 'monthly')),
  interval_count integer not null default 1,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table jobs add column series_id uuid references job_series(id) on delete set null;
create index jobs_series_id_idx on jobs(series_id);

alter table job_series enable row level security;

create policy "job_series: admin all" on job_series
  for all using (is_admin());
