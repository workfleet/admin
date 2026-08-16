-- Simple 1-5 star client rating per completed job, feeding into cleaner
-- reliability scoring alongside punctuality/completion/photo compliance.
create table job_ratings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null unique,
  client_id uuid references clients(id) on delete cascade not null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

alter table job_ratings enable row level security;

-- Client can only rate a job that's actually theirs (via property ->
-- client), not just any job/client_id pair they might guess.
create policy "job_ratings: client insert own" on job_ratings
  for insert with check (
    client_id in (select client_id from profiles where id = auth.uid())
    and exists (
      select 1 from jobs j join properties p on p.id = j.property_id
      where j.id = job_id and p.client_id = job_ratings.client_id
    )
  );

create policy "job_ratings: client select own" on job_ratings
  for select using (client_id in (select client_id from profiles where id = auth.uid()));

create policy "job_ratings: staff select" on job_ratings
  for select using (is_staff());
