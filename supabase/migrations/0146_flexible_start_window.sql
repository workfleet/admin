-- A shift that can be started any time within a window.
--
-- The Bus Station night clean is booked at 23:00 on the night it belongs to,
-- so the rota shows Tuesday night's clean on Tuesday and nobody has to
-- remember that "02:00 Wednesday" means Tuesday night. In practice it can be
-- started any time up to 03:00 - Christopher Carter's clock-ins run from
-- 23:00 to 02:12. The app took 23:00 literally: it sent "You haven't clocked
-- in" at 23:15, and at 02:00 (23:00 + 3 hours) marked the shift missed if he
-- had not arrived yet, which on 10 and 12 Nov 2026 he had not.
--
-- start_window_minutes is how long after the booked start someone may begin
-- and still be on time. Null means no window: everything behaves as before.
-- With one, a shift is only missed once the full booked time has run out
-- counting from the latest start, and the clock-in reminder waits until
-- the window closes (api/admin/clockin-nudge). Pay is unchanged - it comes
-- from the clock-in and clock-out as always.
--
-- Mirrored in lib/missedClockin.js missedAfter() - change one, change both.

alter table jobs
  add column if not exists start_window_minutes integer
  check (start_window_minutes is null or (start_window_minutes > 0 and start_window_minutes <= 720));

-- Reconcile: same as 0098 except the missed test counts from the latest
-- start rather than the booked one.
create or replace function reconcile_job_statuses() returns void as $$
begin
  update jobs
  set status = 'missed'
  where status = 'scheduled'
    and scheduled_at
        + (coalesce(start_window_minutes, 0) || ' minutes')::interval
        + (duration_minutes || ' minutes')::interval < now()
    and not exists (
      select 1 from checkins c where c.job_id = jobs.id and c.checked_in_at is not null
    );

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

-- "I worked this but forgot to clock in": not offered on a flexible shift
-- until it could really have been missed (same rule as above, 0076 otherwise).
drop policy if exists "missed_clockin_claims: cleaner insert own" on missed_clockin_claims;
create policy "missed_clockin_claims: cleaner insert own" on missed_clockin_claims
  for insert with check (
    cleaner_id = auth.uid()
    and is_active_cleaner()
    and is_assigned_to_job(job_id)
    and worked_to <= now()
    and exists (
      select 1 from jobs j
      where j.id = job_id
        and (
          j.status = 'missed'
          or (j.status = 'scheduled'
              and j.scheduled_at
                  + (coalesce(j.start_window_minutes, 0) || ' minutes')::interval
                  + (j.duration_minutes || ' minutes')::interval < now())
        )
    )
  );

-- The Bus Station night series (23:00, 3 hours): start any time up to 03:00.
-- Only visits still to come; finished ones are history.
update jobs
set start_window_minutes = 240
where series_id = 'b01c0bde-3cd8-465c-87db-9c080dcf5334'
  and status = 'scheduled';
