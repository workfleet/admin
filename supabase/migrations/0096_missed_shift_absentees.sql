-- "They worked it" paid everyone on the job, including the one who did not.
--
-- admin_confirm_missed_shift (0078) is job-level: it writes an approved
-- claim, an attendance row and a notification for every assignee and
-- completes the job, which pays each their even share. When 0078 was
-- written the hours model could say nothing else. 0093 then gave each
-- person a reason - did not turn up, off sick - and 0094 gave each person
-- their own minutes, but confirming the shift still ignored both: record
-- Jasmine as a no-show, press "they worked it" for Jennie, and Jasmine was
-- paid thirty minutes for a shift she was not at.
--
-- Now anyone on the job with a reason recorded is absent: paid nothing, no
-- attendance row, no "you have been paid" message, and their absence entry
-- stays in the record. The people without a reason are the ones who worked,
-- and they split the booked time between them - one of two turning up and
-- doing the whole hour is paid the hour. The same applies when a claim is
-- approved on a shift where a colleague is recorded absent. A claim from
-- someone who was recorded absent means the record was wrong: approving it
-- removes their absence entry and pays them as a worker.

-- Writes the per-person minutes for a shift about to be completed, given
-- who is recorded absent. Fills only blanks: a figure the office has already
-- set by hand stands. Returns how many people worked. Called from the two
-- definer functions below, so it runs as their owner; nothing else needs to
-- call it.
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
    and o.cleaner_id = a.cleaner_id
    and a.paid_minutes is null;

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

revoke execute on function apply_missed_shift_absences(uuid) from public;

create or replace function admin_confirm_missed_shift(
  target_job_id uuid,
  note text default null
) returns text as $$
declare
  target jobs;
  assignee record;
  claimed_from timestamptz;
  claimed_to timestamptz;
  assignee_count int;
  workers int;
begin
  if not is_admin_or_supervisor() then return 'not_allowed'; end if;

  select * into target from jobs where id = target_job_id for update;
  if not found then return 'not_found'; end if;

  if not (
    target.status = 'missed'
    or (target.status = 'scheduled'
        and target.scheduled_at + (target.duration_minutes || ' minutes')::interval < now())
  ) then
    return 'not_missed';
  end if;

  select count(*) into assignee_count from job_assignments where job_id = target_job_id;
  if assignee_count = 0 then return 'no_assignees'; end if;

  -- Who is being paid: everyone on the job without a reason recorded. If
  -- everyone has one, nobody worked it and there is nothing to confirm.
  select count(*) into workers
  from job_assignments a
  where a.job_id = target_job_id
    and not exists (select 1 from missed_shift_outcomes o where o.job_id = a.job_id and o.cleaner_id = a.cleaner_id);
  if workers = 0 then return 'nobody_worked'; end if;

  claimed_from := target.scheduled_at;
  claimed_to := target.scheduled_at + (coalesce(target.duration_minutes, 120) || ' minutes')::interval;

  for assignee in
    select a.cleaner_id from job_assignments a
    where a.job_id = target_job_id
      and not exists (select 1 from missed_shift_outcomes o where o.job_id = a.job_id and o.cleaner_id = a.cleaner_id)
  loop
    update missed_clockin_claims
    set status = 'approved',
        admin_note = coalesce(note, admin_note),
        decided_by = auth.uid(),
        decided_at = now()
    where job_id = target_job_id and cleaner_id = assignee.cleaner_id and status = 'pending';

    if not found then
      insert into missed_clockin_claims (
        job_id, cleaner_id, worked_from, worked_to, reason,
        status, admin_note, decided_by, decided_at, raised_by_admin
      ) values (
        target_job_id, assignee.cleaner_id, claimed_from, claimed_to, null,
        'approved', note, auth.uid(), now(), true
      );
    end if;

    if not exists (
      select 1 from checkins where job_id = target_job_id and cleaner_id = assignee.cleaner_id
    ) then
      insert into checkins (job_id, cleaner_id, checked_in_at, checked_out_at, self_declared)
      values (target_job_id, assignee.cleaner_id, claimed_from, claimed_to, true);
    end if;

    insert into notifications (user_id, message)
    values (assignee.cleaner_id,
      'The office has recorded you as having worked a shift you did not clock in for'
      || coalesce(' - ' || note, '')
      || '. Those hours now count towards your pay and holiday.');
  end loop;

  -- Per-person minutes before the status flips, so that if payroll has
  -- already closed this week the one adjustment written is the right one.
  perform apply_missed_shift_absences(target_job_id);

  update jobs set status = 'completed'
  where id = target_job_id and status <> 'completed';

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

create or replace function decide_missed_clockin_claim(
  target_claim_id uuid,
  decision text,
  note text default null
) returns text as $$
declare
  target missed_clockin_claims;
  existing_checkin uuid;
  booked_minutes numeric;
  claimed_minutes numeric;
  workers int;
begin
  if decision not in ('approved', 'declined') then return 'bad_decision'; end if;

  select * into target from missed_clockin_claims where id = target_claim_id for update;
  if not found then return 'not_found'; end if;

  if not is_admin_or_supervisor() then return 'not_allowed'; end if;
  if target.status <> 'pending' then return 'already_decided'; end if;

  update missed_clockin_claims
  set status = decision,
      admin_note = note,
      decided_by = auth.uid(),
      decided_at = now()
  where id = target_claim_id;

  if decision = 'declined' then
    insert into notifications (user_id, message)
    values (target.cleaner_id, 'Your missed clock-in claim was declined'
      || coalesce(' - ' || note, '') || '. Message the office if that is not right.');
    return 'ok';
  end if;

  -- Approving says they worked it. If the office had them down as absent,
  -- the record was wrong and goes.
  delete from missed_shift_outcomes
  where job_id = target.job_id and cleaner_id = target.cleaner_id;

  select id into existing_checkin
  from checkins where job_id = target.job_id and cleaner_id = target.cleaner_id;

  if existing_checkin is null then
    insert into checkins (job_id, cleaner_id, checked_in_at, checked_out_at, self_declared)
    values (target.job_id, target.cleaner_id, target.worked_from, target.worked_to, true);
  end if;

  -- Their share is of the people who worked, not of everyone assigned, and
  -- in proportion when what they claimed is shorter than the booking
  -- (0094). Set before the helper, which fills only blanks.
  select coalesce(duration_minutes, 120) into booked_minutes from jobs where id = target.job_id;
  claimed_minutes := round(extract(epoch from (target.worked_to - target.worked_from)) / 60);
  select count(*) into workers
  from job_assignments a
  where a.job_id = target.job_id
    and not exists (select 1 from missed_shift_outcomes o where o.job_id = a.job_id and o.cleaner_id = a.cleaner_id);
  if booked_minutes > 0 and claimed_minutes < booked_minutes then
    update job_assignments
    set paid_minutes = round(booked_minutes / greatest(workers, 1) * (claimed_minutes / booked_minutes))::int,
        paid_minutes_reason = 'Missed clock-in claim: ' || claimed_minutes || ' of ' || booked_minutes || ' booked minutes',
        paid_minutes_set_by = auth.uid(),
        paid_minutes_set_at = now()
    where job_id = target.job_id
      and cleaner_id = target.cleaner_id
      and paid_minutes is null;
  end if;

  perform apply_missed_shift_absences(target.job_id);

  update jobs set status = 'completed'
  where id = target.job_id and status <> 'completed';

  insert into notifications (user_id, message)
  values (target.cleaner_id, 'Your missed clock-in was approved - those hours now count towards your pay and holiday.');

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;
