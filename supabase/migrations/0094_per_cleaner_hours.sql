-- Hours per person, not only per job.
--
-- Until now a job's hours were one figure split evenly across everyone
-- assigned: a completed 4-hour job with two people on it paid two hours
-- each, whatever happened on the day. There was no way to say that one of
-- them arrived an hour late, that one of them never came and the other did
-- the whole thing alone, or that a claim for a missed clock-in described
-- two of the three hours booked. The model could not express any of it, so
-- the office either paid the booked split or nothing.
--
-- job_assignments now carries an optional paid_minutes per person. Null
-- means the booked share, as before, so nothing already recorded changes.
-- Set, it is what that person is paid for that job, with a reason and who
-- set it. Everything that turns a completed job into hours reads it
-- through one function: the payroll preview and close, the adjustments
-- written after a close, and the holiday balance a request is checked
-- against. Approving a missed clock-in claim sets it in proportion when the
-- claimed time is shorter than the booking.
--
-- The booking is still the source of the figure. This is the correction to
-- it, per person, made by someone with a reason - the same stance 0079 took
-- with the clock: a witness, not the ledger.

alter table job_assignments
  add column if not exists paid_minutes integer check (paid_minutes >= 0),
  add column if not exists paid_minutes_reason text,
  add column if not exists paid_minutes_set_by uuid references profiles(id) on delete set null,
  add column if not exists paid_minutes_set_at timestamptz;

-- The one definition of what a person is owed for a job. Zero unless the
-- job is completed and they are on it; then their override if there is one,
-- else the booked duration split evenly. lib/hoursWorked.js says the same
-- thing for the pages; the two must agree.
--
-- Not a definer function: it is read from inside the definer functions
-- below, where it runs as their owner anyway, and a cleaner calling it
-- directly sees only the rows their own policies allow.
create or replace function assignment_paid_minutes(target_job_id uuid, target_cleaner_id uuid)
returns numeric as $$
  select case
    when j.status = 'completed' and a.id is not null then
      coalesce(
        a.paid_minutes::numeric,
        coalesce(j.duration_minutes, 0)::numeric
          / greatest((select count(*) from job_assignments x where x.job_id = j.id), 1)
      )
    else 0
  end
  from jobs j
  left join job_assignments a on a.job_id = j.id and a.cleaner_id = target_cleaner_id
  where j.id = target_job_id
$$ language sql stable set search_path = public;

-- The payroll preview and the snapshot the close takes (0082), per person.
create or replace function payroll_period_lines_for(p_start date, p_end date)
returns table (
  cleaner_id uuid,
  cleaner_name text,
  job_id uuid,
  job_address text,
  job_date date,
  minutes numeric
) as $$
begin
  if not is_admin() then return; end if;

  return query
    select
      a.cleaner_id,
      pr.full_name,
      j.id,
      p.address,
      payroll_local_date(j.scheduled_at),
      coalesce(assignment_paid_minutes(j.id, a.cleaner_id), 0)
    from jobs j
    join job_assignments a on a.job_id = j.id
    left join profiles pr on pr.id = a.cleaner_id
    left join properties p on p.id = j.property_id
    where j.status = 'completed'
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end
      and not exists (select 1 from payroll_period_lines l where l.job_id = j.id)
    order by pr.full_name, j.scheduled_at;
end;
$$ language plpgsql stable security definer set search_path = public;

-- What each person is now owed for a job payroll has a stake in, against
-- what they have been paid (0082). Only the owed line changes: it reads the
-- per-person figure instead of recomputing the even split here.
create or replace function payroll_record_job_change(target_job_id uuid, deleting boolean, reason text)
returns void as $$
declare
  job_row jobs;
  d date;
  period uuid;
  owed numeric;
  paid numeric;
  addr text;
  cname text;
  rec record;
begin
  select * into job_row from jobs where id = target_job_id;
  if not found then return; end if;

  d := payroll_local_date(job_row.scheduled_at);
  select id into period from payroll_periods where d >= period_start and d < period_end;

  if period is null
     and not exists (select 1 from payroll_period_lines where job_id = target_job_id)
     and not exists (select 1 from payroll_adjustments where job_id = target_job_id) then
    return;
  end if;

  if period is null then
    select period_id into period from payroll_period_lines where job_id = target_job_id limit 1;
  end if;

  select p.address into addr from properties p where p.id = job_row.property_id;

  for rec in
    select a.cleaner_id from job_assignments a where a.job_id = target_job_id
    union
    select l.cleaner_id from payroll_period_lines l where l.job_id = target_job_id and l.cleaner_id is not null
    union
    select x.cleaner_id from payroll_adjustments x where x.job_id = target_job_id and x.cleaner_id is not null
  loop
    if deleting then
      owed := 0;
    else
      -- Zero when the job is not completed or they are no longer on it.
      owed := coalesce(assignment_paid_minutes(target_job_id, rec.cleaner_id), 0);
    end if;

    paid := payroll_paid_minutes(rec.cleaner_id, target_job_id);

    if owed <> paid then
      select full_name into cname from profiles where id = rec.cleaner_id;
      insert into payroll_adjustments
        (cleaner_id, cleaner_name, job_id, job_address, job_date, original_period_id, minutes, reason)
      values
        (rec.cleaner_id, cname, target_job_id, addr, d, period, owed - paid, reason);
    end if;
  end loop;
end;
$$ language plpgsql security definer set search_path = public;

-- A correction to one person's minutes after a close is an adjustment like
-- any other change to the job, and the reason on it should say so rather
-- than "assignment changed".
create or replace function payroll_assignments_changed() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform payroll_record_job_change(old.job_id, false, 'Taken off the job after payroll closed');
    return old;
  end if;

  if tg_op = 'UPDATE' and new.job_id = old.job_id and new.paid_minutes is distinct from old.paid_minutes then
    perform payroll_record_job_change(new.job_id, false,
      case when new.paid_minutes is null
        then 'Hours put back to the booked share after payroll closed'
        else 'Hours corrected to ' || new.paid_minutes || ' min after payroll closed'
          || coalesce(' - ' || nullif(trim(new.paid_minutes_reason), ''), '')
      end);
    return new;
  end if;

  perform payroll_record_job_change(new.job_id, false,
    case when tg_op = 'INSERT' then 'Added to the job after payroll closed'
         else 'Job assignment changed after payroll closed' end);

  if tg_op = 'UPDATE' and new.job_id is distinct from old.job_id then
    perform payroll_record_job_change(old.job_id, false, 'Taken off the job after payroll closed');
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- The holiday balance a request is checked against (0030, 0088) accrues on
-- the same per-person figure, so a shift paid at two of four hours earns
-- holiday on two.
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

  select coalesce(sum(assignment_paid_minutes(ja.job_id, ja.cleaner_id)), 0) / 60.0 into worked_hours
  from job_assignments ja
  where ja.cleaner_id = new.cleaner_id;

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

-- Approving a claim (0076) now pays what was claimed when that is less than
-- the booking. The claim's times were always typed in and signed off; until
-- now they were kept only as the attendance record while pay came from the
-- booked share regardless. In proportion, because on a shared job the
-- claimed window covers the whole shift and their share of it is a
-- fraction. Capped at the booked share: staying late is a time extension
-- request, not a claim. An override the office has already set is kept.
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
  on_job int;
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

  select id into existing_checkin
  from checkins where job_id = target.job_id and cleaner_id = target.cleaner_id;

  if existing_checkin is null then
    insert into checkins (job_id, cleaner_id, checked_in_at, checked_out_at, self_declared)
    values (target.job_id, target.cleaner_id, target.worked_from, target.worked_to, true);
  end if;

  -- Before the status flips below, so that if payroll has already closed
  -- this week the one adjustment it writes is for the right figure.
  select coalesce(duration_minutes, 120) into booked_minutes from jobs where id = target.job_id;
  claimed_minutes := round(extract(epoch from (target.worked_to - target.worked_from)) / 60);
  if booked_minutes > 0 and claimed_minutes < booked_minutes then
    select count(*) into on_job from job_assignments where job_id = target.job_id;
    update job_assignments
    set paid_minutes = round(booked_minutes / greatest(on_job, 1) * (claimed_minutes / booked_minutes))::int,
        paid_minutes_reason = 'Missed clock-in claim: ' || claimed_minutes || ' of ' || booked_minutes || ' booked minutes',
        paid_minutes_set_by = auth.uid(),
        paid_minutes_set_at = now()
    where job_id = target.job_id
      and cleaner_id = target.cleaner_id
      and paid_minutes is null;
  end if;

  update jobs set status = 'completed'
  where id = target.job_id and status <> 'completed';

  insert into notifications (user_id, message)
  values (target.cleaner_id, 'Your missed clock-in was approved - those hours now count towards your pay and holiday.');

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;
