-- Not clocking in on a shared shift is unpaid by default.
--
-- 0132 listed the person on a shared shift who never clocked in while a
-- colleague did, but left them paid until the office recorded a reason.
-- That is the wrong default. A shift nobody clocks into is unpaid unless the
-- office says "they worked it" (0078); one person staying away from a
-- shared shift should be treated the same. Naomi was paid her share of
-- three Axis Court shifts she was off sick for on 11 Nov 2026 until the
-- office zeroed them by hand on the rota.
--
-- settle_shared_shift_pay() decides it, and runs whenever the answer can
-- change: the job completing, someone clocking in, a reason being recorded
-- or removed, or a claim being approved (including "they worked it" on
-- Requests, admin_confirm_colleague_worked from 0132).
--
-- On a completed job where at least one person clocked in:
--   * Anyone with a reason recorded is paid 0 (as 0096).
--   * Anyone who did not clock in and has no approved claim is paid 0,
--     "Did not clock in - a colleague worked the shift". Hours the office set
--     by hand afterwards (on the rota, or Amend Hours) are left alone; hours
--     set when the job was booked are overridden, as those were a plan.
--   * The people who worked keep what they had. Nothing here raises
--     anyone's pay; topping up a colleague who covered is done on the rota.
-- Figures this function wrote are cleared and worked out again each time,
-- so pressing "they worked it" or Undo puts the person back.
--
-- Mirrored for the pages in lib/missedClockin.js (partlyMissedShifts) and
-- the cleaner profile's completion rate - change one, change all.

-- Whether this person is absent from this job: a reason recorded, or no
-- clock-in and no approved claim.
create or replace function shared_shift_absent(target_job_id uuid, target_cleaner_id uuid) returns boolean as $$
  select exists (select 1 from missed_shift_outcomes o where o.job_id = target_job_id and o.cleaner_id = target_cleaner_id)
    or (
      not exists (select 1 from checkins c where c.job_id = target_job_id and c.cleaner_id = target_cleaner_id and c.checked_in_at is not null)
      and not exists (select 1 from missed_clockin_claims m where m.job_id = target_job_id and m.cleaner_id = target_cleaner_id and m.status = 'approved')
    )
$$ language sql stable security definer set search_path = public;

revoke execute on function shared_shift_absent(uuid, uuid) from public, anon, authenticated;

create or replace function settle_shared_shift_pay(target_job_id uuid) returns void as $$
declare
  j jobs;
  total int;
  absent int;
  workers int;
begin
  select * into j from jobs where id = target_job_id;
  if not found or j.status <> 'completed' then return; end if;
  if not exists (select 1 from checkins c where c.job_id = target_job_id and c.checked_in_at is not null) then
    -- Nobody clocked in: settled by "they worked it" on a missed shift (0096).
    return;
  end if;

  -- Start again from what people set, not from what this wrote last time:
  -- someone it zeroed who has since clocked in, had a claim approved or had
  -- their reason removed goes back to their booked share. (Not 'Worked the
  -- shift with ...': those are the workers' figures from "they worked it"
  -- on a missed shift, 0096, and stand.)
  update job_assignments
  set paid_minutes = null, paid_minutes_reason = null,
      paid_minutes_set_by = auth.uid(), paid_minutes_set_at = now()
  where job_id = target_job_id
    and (paid_minutes_reason like 'Did not clock in - %'
      or paid_minutes_reason like 'Recorded as %')
    and not exists (select 1 from missed_shift_outcomes o where o.job_id = target_job_id and o.cleaner_id = job_assignments.cleaner_id)
    and (paid_minutes_reason like 'Recorded as %' or not shared_shift_absent(target_job_id, job_assignments.cleaner_id));

  select count(*) into total from job_assignments where job_id = target_job_id;
  select count(*) into absent from job_assignments a
  where a.job_id = target_job_id and shared_shift_absent(target_job_id, a.cleaner_id);
  workers := total - absent;
  if absent = 0 then return; end if;

  -- A reason recorded: unpaid, whatever was set.
  update job_assignments a
  set paid_minutes = 0,
      paid_minutes_reason = 'Recorded as '
        || case o.outcome
             when 'client_cancelled' then 'client cancelled'
             when 'sick' then 'off sick'
             when 'authorised_absence' then 'authorised absence'
             when 'no_show' then 'did not turn up'
             when 'turned_away' then 'turned away on site'
             else 'absent'
           end
        || ' - the rest of the team worked the shift',
      paid_minutes_set_by = auth.uid(),
      paid_minutes_set_at = now()
  from missed_shift_outcomes o
  where a.job_id = target_job_id and o.job_id = a.job_id and o.cleaner_id = a.cleaner_id
    and (a.paid_minutes is distinct from 0 or coalesce(a.paid_minutes_reason, '') not like 'Recorded as %');

  -- No clock-in, nothing recorded: unpaid unless the office set their hours
  -- by hand after booking.
  update job_assignments a
  set paid_minutes = 0,
      paid_minutes_reason = 'Did not clock in - a colleague worked the shift',
      paid_minutes_set_by = auth.uid(),
      paid_minutes_set_at = now()
  where a.job_id = target_job_id
    and shared_shift_absent(target_job_id, a.cleaner_id)
    and not exists (select 1 from missed_shift_outcomes o where o.job_id = a.job_id and o.cleaner_id = a.cleaner_id)
    and (a.paid_minutes is null or a.paid_minutes_reason = 'Hours set when the job was booked');

  -- The people who worked are left exactly as they were. Whether the one
  -- who did should be paid the absent person's time too depends on whether
  -- they covered it, which only the office knows: on 11 Nov Natasha was
  -- given the full shift by hand, but at Dyfatty a 4-hour job is booked as
  -- 2 hours each, and doubling that automatically would be a guess.
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function settle_shared_shift_pay(uuid) from public, anon, authenticated;

-- A reason recorded or removed (replaces 0132's version).
create or replace function missed_shift_outcome_changed() returns trigger as $$
declare
  jid uuid := coalesce(new.job_id, old.job_id);
  job_status text;
  clocked boolean;
begin
  select status into job_status from jobs where id = jid;
  if job_status is distinct from 'completed' then return null; end if;
  select exists (select 1 from checkins c where c.job_id = jid and c.checked_in_at is not null) into clocked;

  if clocked then
    perform settle_shared_shift_pay(jid);
  else
    -- Completed with no clock-ins: the office recorded it as worked (0078).
    if tg_op = 'DELETE' then
      update job_assignments
      set paid_minutes = null, paid_minutes_reason = null,
          paid_minutes_set_by = auth.uid(), paid_minutes_set_at = now()
      where job_id = jid
        and ((cleaner_id = old.cleaner_id and paid_minutes_reason like 'Recorded as %')
          or paid_minutes_reason like 'Worked the shift with %');
    end if;
    perform apply_missed_shift_absences(jid);
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function missed_shift_outcome_changed() from public, anon, authenticated;

-- The job completing.
create or replace function jobs_settle_shared_shift_pay() returns trigger as $$
begin
  perform settle_shared_shift_pay(new.id);
  return null;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function jobs_settle_shared_shift_pay() from public, anon, authenticated;

drop trigger if exists jobs_settle_shared_shift_pay on jobs;
create trigger jobs_settle_shared_shift_pay
  after update of status on jobs
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function jobs_settle_shared_shift_pay();

-- Someone clocking in, or a claim being approved, on a job already completed.
create or replace function settle_shared_shift_pay_for_row() returns trigger as $$
begin
  perform settle_shared_shift_pay(new.job_id);
  return null;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function settle_shared_shift_pay_for_row() from public, anon, authenticated;

drop trigger if exists checkins_settle_shared_shift_pay on checkins;
create trigger checkins_settle_shared_shift_pay
  after insert or update of checked_in_at on checkins
  for each row
  when (new.checked_in_at is not null)
  execute function settle_shared_shift_pay_for_row();

drop trigger if exists claims_settle_shared_shift_pay on missed_clockin_claims;
create trigger claims_settle_shared_shift_pay
  after insert or update of status on missed_clockin_claims
  for each row
  when (new.status = 'approved')
  execute function settle_shared_shift_pay_for_row();

-- Everything not yet paid: completed jobs since the last payroll close.
-- Older weeks have been paid; changing them would write adjustments
-- against closed periods, which is the office's call, not a migration's.
do $$
declare
  since date;
  r record;
begin
  select max(period_end) into since from payroll_periods;
  for r in
    select id from jobs
    where status = 'completed'
      and payroll_local_date(scheduled_at) >= coalesce(since, current_date - 42)
  loop
    perform settle_shared_shift_pay(r.id);
  end loop;
end $$;
