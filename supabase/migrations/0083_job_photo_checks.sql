-- What the photo check said at check-out, and whether the cleaner went anyway.
--
-- The property checklist (0054) tells a cleaner what "done" looks like at a
-- site, and the photos they take are the evidence it was. Nothing joined the
-- two: a cleaner could photograph the hallway twice and leave with no picture
-- of the bathroom, and the first anyone knew was a client complaint the
-- photos could not answer. Now, when they press Check Out, the photos are
-- compared with the checklist's rooms (api/jobs/photo-check) and any room
-- without a photo is named while they are still standing in the building.
--
-- This table is the record of that: which areas were covered, which were
-- not, and whether the cleaner chose to check out regardless. Kept so the
-- office can see it on the job afterwards and the AI report can mention it,
-- and so "the app never warned me" is answerable either way.
create table job_photo_checks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null,
  cleaner_id uuid references profiles(id) on delete set null,
  photo_count integer not null default 0,
  -- { areas: [{ area, covered, note }], summary }
  result jsonb not null,
  missing_count integer not null default 0,
  proceeded_anyway boolean not null default false,
  created_at timestamptz not null default now()
);

create index job_photo_checks_job_id_idx on job_photo_checks(job_id, created_at desc);

alter table job_photo_checks enable row level security;

-- Written only by the server route with the service role, which bypasses
-- these. The cleaner sees their own checks; the office sees all of them.
create policy "job_photo_checks: cleaner select own" on job_photo_checks
  for select using (cleaner_id = auth.uid());

create policy "job_photo_checks: admin or supervisor select" on job_photo_checks
  for select using (is_admin_or_supervisor());
