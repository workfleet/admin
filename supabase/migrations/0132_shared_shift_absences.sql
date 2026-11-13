-- Someone off a shared shift that a colleague worked.
--
-- 'missed' is a job status (reconcile_job_statuses, 0098): a job goes
-- missed only when nobody clocks in. Once one person on a shared visit
-- clocks in, the job runs and completes as usual, and anyone on it who
-- stayed at home vanishes - no missed shift, nothing in Missed Clock-ins,
-- nothing holding the payroll close, and the booked share of the time
-- still paid to them unless the office edits it by hand. Naomi was off
-- sick for three Axis Court shifts on 11 Nov 2026 that Natasha worked; the
-- office zeroed her hours on the rota, but nothing recorded her as absent.
-- 36 shared shifts since 1 Sep had someone on them who never clocked in.
--
-- Three changes:
--
-- 1. Recording a reason (missed_shift_outcomes) for someone on a job that
--    is already completed now takes them off its pay - the same thing
--    "they worked it" does for the absent on a missed job (0096). Removing
--    the reason (Undo) puts back the booked share.
--
-- 2. apply_missed_shift_absences() zeroes the absent whatever figure they
--    held. It used to fill blanks only, but since hours are now set when a
--    job is booked ("Hours set when the job was booked"), most people
--    already hold a figure, so the absent kept theirs and were paid.
--    The people who worked keep any figure already set.
--
-- 3. payroll_close_review() holds the close on anyone on a completed job
--    who did not clock in while a colleague did, until the office records
--    a reason or confirms they worked it (admin_confirm_colleague_worked
--    below). lib/missedClockin.js partlyMissedShifts() applies the same
--    rule for the Missed Clock-ins page - change one, change both.

-- 2.
create or replace function apply_missed_shift_absences(target_job_id uuid) returns int as $$
declare
  booked numeric;
  total int;
  absent int;
  workers int;
begin
  select coalesce(duration_minutes, 120) into booked from jobs where id = target_job_id;
  select count(*) into total from job_assignments where job_id = target_job_id;
  select count(*) into absent
  from job_assignments a
  where a.job_id = target_job_id
    and exists (select 1 from missed_shift_outcomes o where o.job_id = a.job_id and o.cleaner_id = a.cleaner_id);
  workers := total - absent;

  if absent = 0 then return workers; end if;

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
  where a.job_id = target_job_id
    and o.job_id = a.job_id
    and o.cleaner_id = a.cleaner_id;

  if workers > 0 then
    update job_assignments a
    set paid_minutes = round(booked / workers)::int,
        paid_minutes_reason = 'Worked the shift with ' || absent || ' of ' || total || ' absent',
        paid_minutes_set_by = auth.uid(),
        paid_minutes_set_at = now()
    where a.job_id = target_job_id
      and a.paid_minutes is null
      and not exists (select 1 from missed_shift_outcomes o where o.job_id = a.job_id and o.cleaner_id = a.cleaner_id);
  end if;

  return workers;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function apply_missed_shift_absences(uuid) from public, anon, authenticated;

-- 1.
create or replace function missed_shift_outcome_changed() returns trigger as $$
declare
  jid uuid := coalesce(new.job_id, old.job_id);
  job_status text;
begin
  select status into job_status from jobs where id = jid;
  -- A missed job is settled by "they worked it" (0078/0096), which runs the
  -- helper itself. Only a job that has already completed needs it here.
  if job_status is distinct from 'completed' then return null; end if;

  if tg_op = 'DELETE' then
    -- Undo: back to the booked share. Only figures this path wrote are
    -- cleared; anything the office set by hand on the rota stands.
    update job_assignments
    set paid_minutes = null, paid_minutes_reason = null,
        paid_minutes_set_by = auth.uid(), paid_minutes_set_at = now()
    where job_id = jid
      and (
        (cleaner_id = old.cleaner_id and paid_minutes_reason like 'Recorded as %')
        or paid_minutes_reason like 'Worked the shift with %'
      );
  end if;

  perform apply_missed_shift_absences(jid);
  return null;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function missed_shift_outcome_changed() from public, anon, authenticated;

drop trigger if exists missed_shift_outcome_changed on missed_shift_outcomes;
create trigger missed_shift_outcome_changed
  after insert or update or delete on missed_shift_outcomes
  for each row execute function missed_shift_outcome_changed();

-- They were there and forgot to clock in. Pay is untouched - they already
-- hold their share - so this only records the decision, as an approved
-- claim flagged raised_by_admin, which takes them off the list and out of
-- the payroll hold. Any absence recorded for them goes, as when a claim is
-- approved (0096).
create or replace function admin_confirm_colleague_worked(
  target_job_id uuid,
  target_cleaner_id uuid,
  note text default null
) returns text as $$
declare
  target jobs;
begin
  if not is_admin_or_supervisor() then return 'not_allowed'; end if;

  select * into target from jobs where id = target_job_id;
  if not found then return 'not_found'; end if;
  if target.status <> 'completed' then return 'not_completed'; end if;
  if not exists (select 1 from job_assignments where job_id = target_job_id and cleaner_id = target_cleaner_id) then
    return 'not_assigned';
  end if;

  delete from missed_shift_outcomes where job_id = target_job_id and cleaner_id = target_cleaner_id;

  update missed_clockin_claims
  set status = 'approved', admin_note = coalesce(note, admin_note), decided_by = auth.uid(), decided_at = now()
  where job_id = target_job_id and cleaner_id = target_cleaner_id and status = 'pending';

  if not found and not exists (
    select 1 from missed_clockin_claims
    where job_id = target_job_id and cleaner_id = target_cleaner_id and status = 'approved'
  ) then
    insert into missed_clockin_claims (
      job_id, cleaner_id, worked_from, worked_to, reason,
      status, admin_note, decided_by, decided_at, raised_by_admin
    ) values (
      target_job_id, target_cleaner_id, target.scheduled_at,
      target.scheduled_at + (coalesce(target.duration_minutes, 120) || ' minutes')::interval, null,
      'approved', note, auth.uid(), now(), true
    );
  end if;

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function admin_confirm_colleague_worked(uuid, uuid, text) from public, anon;
grant execute on function admin_confirm_colleague_worked(uuid, uuid, text) to authenticated;

-- 3. Same as 0093 plus the 'colleague_clocked' block at the end.
create or replace function payroll_close_review(p_start date, p_end date)
returns table (
  kind text,
  blocking boolean,
  job_id uuid,
  cleaner_id uuid,
  cleaner_name text,
  job_address text,
  scheduled_at timestamptz,
  detail text
) as $$
begin
  if not is_admin() then return; end if;

  return query
    select 'pending_claim'::text, true, c.job_id, c.cleaner_id, pr.full_name, p.address, j.scheduled_at,
           'Missed clock-in claim waiting for a decision'::text
    from missed_clockin_claims c
    join jobs j on j.id = c.job_id
    left join properties p on p.id = j.property_id
    left join profiles pr on pr.id = c.cleaner_id
    where c.status = 'pending'
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end

    union all

    select 'short_shift'::text, true, j.id, null::uuid, null::text, p.address, j.scheduled_at,
           'Clocked well under the booked time - confirm or correct the hours'::text
    from jobs j
    left join properties p on p.id = j.property_id
    where j.hours_review_needed
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end

    union all

    select 'unfinished'::text, true, j.id, null::uuid, null::text, p.address, j.scheduled_at,
           case when j.status = 'in_progress'
                then 'Still in progress - nobody has checked out yet'
                else 'Not started and not yet marked missed' end
    from jobs j
    left join properties p on p.id = j.property_id
    where j.status in ('scheduled', 'in_progress')
      and not j.hours_review_needed
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end

    union all

    select case when o.id is null then 'missed_shift' else 'missed_recorded' end::text,
           o.id is null,
           j.id, a.cleaner_id, pr.full_name, p.address, j.scheduled_at,
           case o.outcome
             when 'client_cancelled' then 'Client cancelled - unpaid'
             when 'sick' then 'Off sick - unpaid'
             when 'authorised_absence' then 'Authorised absence - unpaid'
             when 'no_show' then 'Did not turn up - unpaid'
             when 'turned_away' then 'Turned away on site - unpaid'
             else 'Nobody clocked in - say what happened before this closes'
           end
    from jobs j
    join job_assignments a on a.job_id = j.id
    left join missed_shift_outcomes o on o.job_id = j.id and o.cleaner_id = a.cleaner_id
    left join profiles pr on pr.id = a.cleaner_id
    left join properties p on p.id = j.property_id
    where j.status = 'missed'
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end
      and not exists (
        select 1 from missed_clockin_claims c
        where c.job_id = j.id and c.cleaner_id = a.cleaner_id and c.status = 'pending'
      )

    union all

    -- A colleague clocked in, this person did not, and nobody has said why.
    select 'colleague_clocked'::text, true, j.id, a.cleaner_id, pr.full_name, p.address, j.scheduled_at,
           'Did not clock in on a shift a colleague worked - record why, or that they worked it'::text
    from jobs j
    join job_assignments a on a.job_id = j.id
    left join profiles pr on pr.id = a.cleaner_id
    left join properties p on p.id = j.property_id
    where j.status = 'completed'
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end
      and exists (select 1 from checkins c where c.job_id = j.id and c.checked_in_at is not null)
      and not exists (
        select 1 from checkins c
        where c.job_id = j.id and c.cleaner_id = a.cleaner_id and c.checked_in_at is not null
      )
      and not exists (select 1 from missed_shift_outcomes o where o.job_id = j.id and o.cleaner_id = a.cleaner_id)
      and not exists (
        select 1 from missed_clockin_claims c
        where c.job_id = j.id and c.cleaner_id = a.cleaner_id and c.status = 'approved'
      )

    order by 7;
end;
$$ language plpgsql stable security definer set search_path = public;
