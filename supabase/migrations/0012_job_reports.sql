-- AI-generated job reports (admin-only): summarizes what was done, issues
-- found, and suggestions going forward, generated from admin-entered notes
-- (typed or voice-transcribed) plus the job's uploaded photos.
create table job_reports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade unique,
  input_notes text,
  summary text,
  issues text,
  suggestions text,
  generated_by uuid references profiles(id),
  created_at timestamptz default now()
);

alter table job_reports enable row level security;

create policy "job_reports: admin all" on job_reports
  for all using (is_admin());
