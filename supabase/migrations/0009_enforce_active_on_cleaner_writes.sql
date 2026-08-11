-- Login-gate alone (app/page.js) only stops a deactivated cleaner from
-- starting a new session — a token issued just before deactivation would
-- still work until it expires. Belt-and-braces: block the write paths a
-- deactivated cleaner could otherwise still use during that window.

create or replace function is_active_cleaner() returns boolean as $$
  select coalesce((select active from profiles where id = auth.uid()), false)
$$ language sql security definer stable;

-- profiles previously only had a self-update policy — admins had no way to
-- update anyone else's profile at all (e.g. to deactivate a cleaner).
create policy "profiles: admin update" on profiles
  for update using (is_admin());

drop policy if exists "jobs: cleaner update own" on jobs;
create policy "jobs: cleaner update own" on jobs
  for update using (cleaner_id = auth.uid() and is_active_cleaner());

drop policy if exists "tasks: cleaner update via job" on tasks;
create policy "tasks: cleaner update via job" on tasks
  for update using (job_id in (select id from jobs where cleaner_id = auth.uid()) and is_active_cleaner());

drop policy if exists "checkins: cleaner own" on checkins;
create policy "checkins: cleaner own" on checkins
  for all using (cleaner_id = auth.uid() and is_active_cleaner());

drop policy if exists "photos: cleaner via job" on photos;
create policy "photos: cleaner via job" on photos
  for all using (job_id in (select id from jobs where cleaner_id = auth.uid()) and is_active_cleaner());

-- job-photos storage: cleaner upload/read also gated on active status.
drop policy if exists "job-photos: cleaner upload own job" on storage.objects;
create policy "job-photos: cleaner upload own job" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and is_active_cleaner()
    and exists (
      select 1 from jobs j
      where j.id::text = split_part(name, '/', 1)
        and j.cleaner_id = auth.uid()
    )
  );

drop policy if exists "job-photos: cleaner read own job" on storage.objects;
create policy "job-photos: cleaner read own job" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and is_active_cleaner()
    and exists (
      select 1 from jobs j
      where j.id::text = split_part(name, '/', 1)
        and j.cleaner_id = auth.uid()
    )
  );
