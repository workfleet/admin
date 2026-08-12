-- Lets a job have multiple assigned cleaners instead of exactly one.
-- jobs.cleaner_id is left in place but no longer read/written by the app
-- or checked by RLS from here on - job_assignments is now the single
-- source of truth for who's on a job. Not dropped: safer to leave an
-- inert deprecated column than risk losing data if something here needs
-- correcting later.

create table job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null,
  cleaner_id uuid references profiles(id) on delete cascade not null,
  created_at timestamptz not null default now(),
  unique (job_id, cleaner_id)
);

create index job_assignments_job_id_idx on job_assignments(job_id);
create index job_assignments_cleaner_id_idx on job_assignments(cleaner_id);

alter table job_assignments enable row level security;

-- Backfill from the old single-cleaner column.
insert into job_assignments (job_id, cleaner_id)
select id, cleaner_id from jobs where cleaner_id is not null
on conflict (job_id, cleaner_id) do nothing;

-- ---- Helper functions (replace the "cleaner_id = auth.uid()" pattern
-- used throughout the old RLS). security definer so they can read
-- job_assignments without recursing back into its own RLS - same
-- pattern as is_admin() and the 0002 recursion fix. ----

create or replace function assigned_job_ids() returns setof uuid as $$
  select job_id from job_assignments where cleaner_id = auth.uid()
$$ language sql security definer stable;

create or replace function is_assigned_to_job(target_job_id uuid) returns boolean as $$
  select exists (
    select 1 from job_assignments where job_id = target_job_id and cleaner_id = auth.uid()
  );
$$ language sql security definer stable;

-- ---- job_assignments RLS ----
-- A cleaner can see every assignment row for any job they're personally
-- on (not just their own row), so they can see who else is on a shared
-- job and so the app can compute an accurate assignee count for
-- duration-splitting.

create policy "job_assignments: admin all" on job_assignments
  for all using (is_admin());

create policy "job_assignments: cleaner select via job" on job_assignments
  for select using (job_id in (select assigned_job_ids()));

create policy "job_assignments: client via job" on job_assignments
  for select using (
    job_id in (
      select j.id from jobs j
      join properties p on p.id = j.property_id
      join profiles pr on pr.client_id = p.client_id
      where pr.id = auth.uid()
    )
  );

-- ---- jobs RLS: membership via job_assignments instead of cleaner_id ----

drop policy if exists "jobs: cleaner own" on jobs;
create policy "jobs: cleaner own" on jobs
  for select using (id in (select assigned_job_ids()));

drop policy if exists "jobs: cleaner update own" on jobs;
create policy "jobs: cleaner update own" on jobs
  for update using (id in (select assigned_job_ids()) and is_active_cleaner());

-- ---- properties RLS: cleaner_property_ids() now goes via job_assignments ----

create or replace function cleaner_property_ids() returns setof uuid as $$
  select property_id from jobs where id in (select assigned_job_ids())
$$ language sql security definer stable;

-- ---- tasks RLS ----

drop policy if exists "tasks: cleaner via job" on tasks;
create policy "tasks: cleaner via job" on tasks
  for select using (job_id in (select assigned_job_ids()));

drop policy if exists "tasks: cleaner update via job" on tasks;
create policy "tasks: cleaner update via job" on tasks
  for update using (job_id in (select assigned_job_ids()) and is_active_cleaner());

-- ---- checkins RLS: already has its own cleaner_id column (each cleaner
-- gets their own row), now also requires the job to actually be assigned
-- to them - previously any active cleaner could technically write a
-- checkin row for ANY job_id as long as they set cleaner_id to
-- themselves, since nothing checked assignment. Closing that here too. ----

drop policy if exists "checkins: cleaner own" on checkins;
create policy "checkins: cleaner own" on checkins
  for all using (cleaner_id = auth.uid() and is_active_cleaner() and is_assigned_to_job(job_id));

-- ---- photos RLS ----

drop policy if exists "photos: cleaner via job" on photos;
create policy "photos: cleaner via job" on photos
  for all using (job_id in (select assigned_job_ids()) and is_active_cleaner());

-- ---- job-photos storage RLS ----

drop policy if exists "job-photos: cleaner upload own job" on storage.objects;
create policy "job-photos: cleaner upload own job" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and is_active_cleaner()
    and exists (
      select 1 from job_assignments ja
      where ja.job_id::text = split_part(name, '/', 1)
        and ja.cleaner_id = auth.uid()
    )
  );

drop policy if exists "job-photos: cleaner read own job" on storage.objects;
create policy "job-photos: cleaner read own job" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'job-photos'
    and is_active_cleaner()
    and exists (
      select 1 from job_assignments ja
      where ja.job_id::text = split_part(name, '/', 1)
        and ja.cleaner_id = auth.uid()
    )
  );

-- ---- Notification trigger: fire per-assignment instead of watching
-- jobs.cleaner_id change ----

drop trigger if exists on_job_cleaner_assigned on jobs;

create or replace function notify_on_job_assignment() returns trigger as $$
begin
  insert into notifications (user_id, message)
  select new.cleaner_id, 'New shift assigned: ' || to_char(j.scheduled_at, 'DD Mon YYYY HH24:MI')
  from jobs j where j.id = new.job_id;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_job_assignment_created
  after insert on job_assignments
  for each row execute procedure notify_on_job_assignment();

-- ---- Job status now derives from aggregate check-in state across every
-- assigned cleaner, not one person's check-in/out. This generalizes the
-- old single-cleaner behavior (1 assigned, 1 checked in -> in_progress;
-- checked out -> completed) rather than replacing it - the app no longer
-- sets jobs.status directly on check-in/out, this trigger does. ----

create or replace function sync_job_status_from_checkins() returns trigger as $$
declare
  target_job_id uuid := coalesce(new.job_id, old.job_id);
  assigned_count int;
  checked_in_count int;
  checked_out_count int;
begin
  select count(*) into assigned_count from job_assignments where job_id = target_job_id;
  select count(*) into checked_in_count from checkins where job_id = target_job_id and checked_in_at is not null;
  select count(*) into checked_out_count from checkins where job_id = target_job_id and checked_out_at is not null;

  if assigned_count > 0 and checked_out_count >= assigned_count then
    update jobs set status = 'completed' where id = target_job_id and status <> 'completed';
  elsif checked_in_count > 0 then
    update jobs set status = 'in_progress' where id = target_job_id and status = 'scheduled';
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger checkins_sync_job_status
  after insert or update on checkins
  for each row execute procedure sync_job_status_from_checkins();

-- ---- Holiday balance: hours worked now split evenly across everyone
-- assigned to a job (per admin decision), rather than counted in full
-- for each person on a shared job. ----

create or replace function enforce_holiday_balance() returns trigger as $$
declare
  worked_hours numeric;
  adjustment numeric;
  accrued numeric;
  committed numeric;
begin
  if new.type <> 'holiday' then
    return new;
  end if;

  select coalesce(sum(j.duration_minutes::numeric / greatest(ac.cnt, 1)), 0) / 60.0 into worked_hours
  from job_assignments ja
  join jobs j on j.id = ja.job_id
  join (select job_id, count(*) as cnt from job_assignments group by job_id) ac on ac.job_id = ja.job_id
  where ja.cleaner_id = new.cleaner_id and j.status = 'completed';

  select coalesce(holiday_adjustment_hours, 0) into adjustment
  from profiles where id = new.cleaner_id;

  accrued := worked_hours * 0.1207 + adjustment;

  select coalesce(sum(hours), 0) into committed
  from time_off_requests
  where cleaner_id = new.cleaner_id
    and type = 'holiday'
    and status in ('approved', 'pending');

  if new.hours > (accrued - committed) then
    raise exception 'Requested % hours exceeds your available holiday balance of % hours', new.hours, round(accrued - committed, 2);
  end if;

  return new;
end;
$$ language plpgsql security definer;
