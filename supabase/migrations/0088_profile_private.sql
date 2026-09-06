-- The staff directory shows names. It was showing everything else too.
--
-- Cleaners can read each other's profile rows so the app can put a name to
-- a teammate, a chat participant, or the colleague whose shift needs cover
-- (0021's "staff directory visible to staff" policy). Row-level security
-- is row-level: the same permission that returns "Laura, cleaner" returns
-- Laura's holiday adjustment and the date she was deactivated, to anyone
-- who asks the API for those columns by name. No screen showed them, but
-- the API would.
--
-- The fix is to stop keeping figures nobody but the office should see on
-- the row everybody can see. They move to profile_private, one row per
-- profile, readable by the office and by the person themself, writable by
-- admins only. Everything that read them from profiles reads from here now;
-- the columns are dropped so nothing can quietly go back to the old way.

create table profile_private (
  profile_id uuid primary key references profiles(id) on delete cascade,
  holiday_adjustment_hours numeric(6,2) not null default 0,
  deactivated_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into profile_private (profile_id, holiday_adjustment_hours, deactivated_at)
select id, coalesce(holiday_adjustment_hours, 0), deactivated_at from profiles;

alter table profile_private enable row level security;

-- Supervisors decide time-off requests against a balance that includes the
-- adjustment, so they can read it; only an admin sets it (as before, when
-- prevent_self_privilege_escalation guarded the column). A cleaner sees
-- their own row so their rota can show their own balance.
create policy "profile_private: office or self select" on profile_private
  for select using (is_admin_or_supervisor() or profile_id = auth.uid());

create policy "profile_private: admin write" on profile_private
  for all using (is_admin()) with check (is_admin());

-- Every profile gets its private row the moment it exists, so nothing has
-- to cope with a missing one.
create or replace function ensure_profile_private() returns trigger as $$
begin
  insert into public.profile_private (profile_id) values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists profiles_ensure_private on profiles;
create trigger profiles_ensure_private
  after insert on profiles
  for each row execute procedure ensure_profile_private();

-- Deactivation is still recorded when active flips (0068), just on the
-- private row. Definer, because the admin flipping the flag has the update
-- policy above, but the trigger should not depend on that.
create or replace function track_profile_deactivation() returns trigger as $$
begin
  if new.active = false and old.active = true then
    insert into public.profile_private (profile_id, deactivated_at)
    values (new.id, now())
    on conflict (profile_id) do update set deactivated_at = now(), updated_at = now();
  elsif new.active = true and old.active = false then
    update public.profile_private
    set deactivated_at = null, updated_at = now()
    where profile_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- The holiday balance trigger (0030) reads the adjustment from here now.
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
  from profile_private where profile_id = new.cleaner_id;
  adjustment := coalesce(adjustment, 0);

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

-- The privilege guard (0010, 0024, 0037) no longer has a holiday column to
-- guard on this table; role and active are still an admin's to change.
create or replace function prevent_self_privilege_escalation() returns trigger as $$
begin
  if auth.uid() is not null and not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change role';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only an admin can change active status';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

alter table profiles
  drop column if exists holiday_adjustment_hours,
  drop column if exists deactivated_at;
