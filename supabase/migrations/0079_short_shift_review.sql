-- Stop a three-second check-out paying an eight-hour shift.
--
-- On 2026-09-02 a cleaner checked in at 13:10:38 and out at 13:10:41 on a job
-- booked for 480 minutes. sync_job_status_from_checkins (0030) completes a
-- job the instant every assignee has a checked_out_at, and lib/hoursWorked.js
-- pays completed jobs by duration_minutes without ever consulting the clock.
-- So 3.5 seconds paid 8 hours, and nothing anywhere said a word about it.
--
-- Two things were wrong and only one of them is the money. The job also went
-- read-only the moment it completed, so the cleaner was locked out of a shift
-- booked until 21:00 with no way back in - resume_auto_checkout (0073)
-- deliberately refuses a manual check-out, on the reasoning that pressing the
-- button is a decision. Pressing it by accident is not, and the office had no
-- undo either. That job had to be repaired by hand.
--
-- The clock does not become the source of hours here - it stays a witness.
-- It cannot set the figure, but below a threshold it can refuse to let the
-- figure stand unexamined.

-- Whether this job's hours are waiting on somebody to confirm them. Not a
-- status: 'in_progress' is still true of it, the rota should still draw it
-- as such, and inventing a fourth status would mean touching every filter,
-- badge and legend in the app to describe a state that is really an
-- annotation.
alter table jobs
  add column if not exists hours_review_needed boolean not null default false;

create index if not exists jobs_hours_review_needed_idx
  on jobs(hours_review_needed) where hours_review_needed;

-- 80% of the time allocated to the job. Set high on purpose: the office would
-- rather look at a shift that finished early than pay one that never
-- happened, so this is a review step with real traffic in it rather than an
-- exception report. Mirrored in lib/shortShift.js - change one, change both.
create or replace function short_shift_ratio() returns numeric as $$
  select 0.8::numeric;
$$ language sql immutable;

create or replace function sync_job_status_from_checkins() returns trigger as $$
declare
  target_job_id uuid := coalesce(new.job_id, old.job_id);
  assigned_count int;
  checked_in_count int;
  checked_out_count int;
  clocked_minutes numeric;
  booked_minutes numeric;
  job_address text;
begin
  select count(*) into assigned_count from job_assignments where job_id = target_job_id;
  select count(*) into checked_in_count from checkins where job_id = target_job_id and checked_in_at is not null;
  select count(*) into checked_out_count from checkins where job_id = target_job_id and checked_out_at is not null;

  if assigned_count > 0 and checked_out_count >= assigned_count then
    -- Everyone is off site. Before this counts as a completed shift, does the
    -- clock agree it was one?
    select coalesce(sum(extract(epoch from (checked_out_at - checked_in_at)) / 60), 0)
      into clocked_minutes
    from checkins
    where job_id = target_job_id and checked_in_at is not null and checked_out_at is not null;

    select coalesce(duration_minutes, 120) into booked_minutes from jobs where id = target_job_id;

    if booked_minutes > 0 and clocked_minutes < booked_minutes * short_shift_ratio() then
      -- Held, not completed. The job stays workable, which is the other half
      -- of the fix: a cleaner who tapped Check Out by mistake can get back in
      -- rather than being locked out of their own shift.
      update jobs set hours_review_needed = true
      where id = target_job_id and hours_review_needed = false;

      -- Only when this row is the one that raised the flag. FOUND is false on
      -- a job already flagged, which is what keeps a second cleaner checking
      -- out of the same short job from sending the alert twice.
      if found then
        select pr.address into job_address
        from jobs j join properties pr on pr.id = j.property_id
        where j.id = target_job_id;

        insert into notifications (user_id, message)
        select id,
          'A shift at ' || coalesce(job_address, 'a property') || ' clocked '
          || round(clocked_minutes) || ' min of ' || round(booked_minutes)
          || ' booked - confirm the hours before payroll'
        from profiles where role in ('admin', 'supervisor');
      end if;

      return new;
    end if;

    update jobs set status = 'completed' where id = target_job_id and status <> 'completed';
  elsif checked_in_count > 0 then
    update jobs set status = 'in_progress' where id = target_job_id and status in ('scheduled', 'missed');
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- reconcile_job_statuses would otherwise undo all of the above an hour later:
-- its in_progress -> completed rule fires on elapsed time alone and would
-- quietly pay exactly the shift the trigger just held back. The rule itself
-- is still right for the case it was written for - somebody who forgot to
-- check out - which is why it keys off the flag rather than off the clock.
create or replace function reconcile_job_statuses() returns void as $$
begin
  update jobs
  set status = 'missed'
  where status = 'scheduled'
    and scheduled_at + (duration_minutes || ' minutes')::interval < now()
    and not exists (
      select 1 from checkins c where c.job_id = jobs.id and c.checked_in_at is not null
    );

  update jobs
  set status = 'completed'
  where status = 'in_progress'
    and not hours_review_needed
    and scheduled_at + (duration_minutes || ' minutes')::interval < now();
end;
$$ language plpgsql security definer;

-- Confirming the hours: the office has looked and says the shift was worked
-- as booked. Definer for the same reason as everything else that writes
-- jobs.status - nothing in the app does it by hand.
create or replace function confirm_short_shift(target_job_id uuid) returns text as $$
declare
  target jobs;
begin
  if not is_admin_or_supervisor() then return 'not_allowed'; end if;

  select * into target from jobs where id = target_job_id for update;
  if not found then return 'not_found'; end if;
  if not target.hours_review_needed then return 'not_flagged'; end if;

  update jobs
  set hours_review_needed = false,
      status = 'completed'
  where id = target_job_id;

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function confirm_short_shift(uuid) to authenticated;

-- Correcting them instead: the shift really was shorter than booked, so the
-- booking is what was wrong. Rewrites duration_minutes, which is what payroll
-- and holiday accrual both read, and completes it. Kept separate from
-- confirm_short_shift so the two decisions cannot be made by the same
-- careless click.
create or replace function correct_short_shift(target_job_id uuid, actual_minutes int)
returns text as $$
declare
  target jobs;
begin
  if not is_admin_or_supervisor() then return 'not_allowed'; end if;
  if actual_minutes is null or actual_minutes <= 0 then return 'bad_minutes'; end if;

  select * into target from jobs where id = target_job_id for update;
  if not found then return 'not_found'; end if;
  if not target.hours_review_needed then return 'not_flagged'; end if;

  update jobs
  set duration_minutes = actual_minutes,
      hours_review_needed = false,
      status = 'completed'
  where id = target_job_id;

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function correct_short_shift(uuid, int) to authenticated;

-- An accidental check-out is now undoable, which it never was.
--
-- 0073 restricted this to the app's own guesses, reasoning that a cleaner who
-- pressed Check Out made a decision. True of a deliberate press at the end of
-- a shift; not true of a mis-tap thirty seconds after arriving, which is what
-- actually happened. So a manual check-out can be walked back too - but only
-- while it is still obviously wrong: inside the same 30-minute window, and
-- only where the clocked time falls short of what the job was booked for.
-- A full shift, properly worked and properly closed, still stands.
create or replace function resume_auto_checkout(target_checkin_id uuid) returns text as $$
declare
  target checkins;
  job_row jobs;
  clocked_minutes numeric;
  decided_at timestamptz;
begin
  select * into target from checkins where id = target_checkin_id for update;
  if not found then return 'not_found'; end if;

  if target.cleaner_id is distinct from auth.uid()
     or not is_active_cleaner()
     or not is_assigned_to_job(target.job_id) then
    return 'not_yours';
  end if;

  if target.checked_out_at is null then return 'already_open'; end if;

  select * into job_row from jobs where id = target.job_id;
  clocked_minutes := extract(epoch from (target.checked_out_at - target.checked_in_at)) / 60;

  if not target.auto_checked_out then
    -- A manual check-out only reopens while it still looks like a slip.
    if job_row.duration_minutes is null
       or clocked_minutes >= coalesce(job_row.duration_minutes, 120) * short_shift_ratio() then
      return 'not_automatic';
    end if;
  end if;

  -- The window runs from when the check-out was written. For an automatic one
  -- that is auto_checked_out_at, which can be hours after the time it wrote
  -- down; for a manual one the check-out time is the moment it happened.
  decided_at := coalesce(target.auto_checked_out_at, target.checked_out_at);
  if decided_at is null or now() - decided_at > interval '30 minutes' then
    return 'expired';
  end if;

  update checkins
  set checked_out_at = null,
      auto_checked_out = false,
      auto_checked_out_at = null,
      last_seen_inside_at = now()
  where id = target_checkin_id;

  -- Reopening clears the review flag too: the shift is being worked again, so
  -- whatever the clock said a moment ago is no longer the whole story.
  update jobs
  set status = 'in_progress',
      hours_review_needed = false
  where id = target.job_id and (status <> 'in_progress' or hours_review_needed);

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;
