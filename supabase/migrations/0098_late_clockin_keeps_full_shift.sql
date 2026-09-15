-- Somebody who clocked in late is still working at the booked end.
--
-- 0080 closes a shift nobody clocked out of at the time the job was booked
-- to end, on the assumption that the cleaner forgot to press the button on
-- the way out. That assumption is wrong for anyone who arrived late. Jennie
-- clocked in at 18:18 for a job booked 17:00-19:00 and was clocked out at
-- 19:00 - 42 minutes in, mid-shift, with the job locked under her - the
-- moment the office opened the rota. Same again the next evening, and once
-- on a morning job; Joanne lost the same way on a 9 Sep shift she joined at
-- 12:21. Each one raised a false "clocked well under the booked time" alert
-- and left an attendance record saying they went home when they had not.
--
-- The booked duration is the promise, not the booked end. A late arrival
-- still owes the full booked time from when they actually started, so the
-- sweep now waits for the LATER of the booked end and clock-in plus the
-- booked duration before it treats the shift as forgotten, and closes it at
-- that time. An early arrival is unchanged: their booked end is the later
-- of the two. Mirrored in lib/autoCheckout.js's catch-up fallback - change
-- one, change both.
create or replace function reconcile_job_statuses() returns void as $$
begin
  update jobs
  set status = 'missed'
  where status = 'scheduled'
    and scheduled_at + (duration_minutes || ' minutes')::interval < now()
    and not exists (
      select 1 from checkins c where c.job_id = jobs.id and c.checked_in_at is not null
    );

  -- Still before completing anything, for the reason 0080 gives: closing the
  -- check-in fires checkins_sync_job_status, which decides whether the shift
  -- is long enough to complete on its own or short enough to hold for review.
  update checkins
  set checked_out_at = least(
        greatest(
          (select j.scheduled_at + (j.duration_minutes || ' minutes')::interval from jobs j where j.id = checkins.job_id),
          checkins.checked_in_at + (select (j.duration_minutes || ' minutes')::interval from jobs j where j.id = checkins.job_id)
        ),
        now()
      ),
      closed_at_booked_end = true
  where checked_out_at is null
    and checked_in_at is not null
    and exists (
      select 1 from jobs j
      where j.id = checkins.job_id
        and j.status = 'in_progress'
        and greatest(
              j.scheduled_at + (j.duration_minutes || ' minutes')::interval,
              checkins.checked_in_at + (j.duration_minutes || ' minutes')::interval
            ) < now()
    );

  -- A job with nobody left on the clock. The open check-in of a late
  -- arrival keeps its job in progress until their time is up, because
  -- completing it would lock the page they are still working from - photos,
  -- task ticks and Check Out all stop the moment a job completes.
  update jobs
  set status = 'completed'
  where status = 'in_progress'
    and not hours_review_needed
    and scheduled_at + (duration_minutes || ' minutes')::interval < now()
    and not exists (
      select 1 from checkins c
      where c.job_id = jobs.id and c.checked_in_at is not null and c.checked_out_at is null
    );
end;
$$ language plpgsql security definer;
