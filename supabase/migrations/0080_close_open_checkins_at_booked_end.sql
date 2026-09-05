-- Close a shift nobody ever clocked out of, instead of leaving it open for ever.
--
-- reconcile_job_statuses() has always completed an in_progress job once its
-- allotted time ran out, which pays the booked hours. What it never did was
-- close the check-in underneath, so the attendance row still says the cleaner
-- is on site - on a shift that finished, completed and paid days ago.
--
-- Salih's 2 Sep shift is the worked example: clocked in 14:10, never clocked
-- out, job completed at 22:00 and paid 8 hours, and the record read "still on
-- site" until somebody corrected it by hand two days later. The pay was right
-- - he worked it - but nothing in the app could say when he left, and the one
-- row that should have said so claimed he never had.
--
-- So the same pass that decides the job is over now closes the shift with it,
-- at the time the job was booked to end. That is a guess, and it is written
-- down as one.

-- Distinct from auto_checked_out on purpose, which means something specific:
-- the app watched their phone leave the geofence and inferred a departure
-- from evidence. Nothing was observed here. The job simply ran out of time
-- with the shift still open, and saying "left the geofence" on three screens
-- would be inventing a fact - the exact failure 0072 added its flag to avoid.
alter table checkins
  add column if not exists closed_at_booked_end boolean not null default false;

create or replace function reconcile_job_statuses() returns void as $$
begin
  update jobs
  set status = 'missed'
  where status = 'scheduled'
    and scheduled_at + (duration_minutes || ' minutes')::interval < now()
    and not exists (
      select 1 from checkins c where c.job_id = jobs.id and c.checked_in_at is not null
    );

  -- Before completing anything. Closing a check-in fires
  -- checkins_sync_job_status, which is what decides whether the shift is long
  -- enough to complete on its own or short enough to hold for review (0079).
  -- Completing first and closing second would flag a job that had already
  -- been paid, which is the worst of both.
  --
  -- Clamped to now() so a job whose booked end is in the future - one being
  -- reconciled early for some reason - can never record a departure that has
  -- not happened yet.
  update checkins
  set checked_out_at = least(
        (select j.scheduled_at + (j.duration_minutes || ' minutes')::interval from jobs j where j.id = checkins.job_id),
        now()
      ),
      closed_at_booked_end = true
  where checked_out_at is null
    and checked_in_at is not null
    and exists (
      select 1 from jobs j
      where j.id = checkins.job_id
        and j.status = 'in_progress'
        and j.scheduled_at + (j.duration_minutes || ' minutes')::interval < now()
    );

  -- Whatever the trigger did not carry to 'completed' itself - a job with no
  -- open check-ins left to close, say. Still respecting the review flag, so a
  -- shift the trigger just held does not get completed out from under it.
  update jobs
  set status = 'completed'
  where status = 'in_progress'
    and not hours_review_needed
    and scheduled_at + (duration_minutes || ' minutes')::interval < now();
end;
$$ language plpgsql security definer;

-- Existing damage: every shift already sitting open on a completed job. These
-- are all past their booked end by definition, and every one of them is an
-- attendance record claiming somebody never went home.
--
-- These must not land in the review queue. Those jobs completed and were paid
-- days or weeks ago, so holding them now would fill the queue with decisions
-- that cannot change anything and would contradict pay already gone out. The
-- trigger cannot be told that, so the flag is cleared behind it below.
update checkins
set checked_out_at = least(
      (select j.scheduled_at + (j.duration_minutes || ' minutes')::interval from jobs j where j.id = checkins.job_id),
      now()
    ),
    closed_at_booked_end = true
where checked_out_at is null
  and checked_in_at is not null
  and exists (
    select 1 from jobs j
    where j.id = checkins.job_id
      and j.status = 'completed'
  );

-- Clearing up after the back-fill. Closing those rows fired
-- checkins_sync_job_status, which will have flagged any whose clocked span
-- fell short of 80% - and on an already-completed job that flag is always an
-- artefact, because the trigger returns before completing and so can never
-- produce a job that is both completed and held. Anything matching both was
-- put there by the statement above.
update jobs
set hours_review_needed = false
where hours_review_needed and status = 'completed';
