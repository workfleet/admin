-- A missed shift has to be accounted for before payroll closes.
--
-- 0082 lists shifts nobody clocked into on the payroll page as a warning and
-- lets the period close over them. Unpaid is the default, and it is silent:
-- nothing records whether the cleaner did not turn up, was off sick, was
-- turned away at the door, or whether the client cancelled the night before.
-- Every one of those reads as 'missed' on the cleaner's record afterwards,
-- and the completion rate on their page counts a client's cancellation
-- against them exactly as it would a no-show.
--
-- So each missed shift now needs an outcome, per person, before the period
-- can close. "They worked it" already exists (admin_confirm_missed_shift,
-- 0078) and pays the shift. Everything here is the unpaid side: a reason
-- recorded by the office, kept per cleaner because sickness and absence are
-- about a person even when the cancellation is about the job.
--
-- None of these pay. Turned away on site is recorded here as unpaid; if the
-- office decides such a shift should be paid as booked, the route is still
-- "they worked it", which is a decision to pay and is recorded as one.

create table missed_shift_outcomes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null,
  cleaner_id uuid references profiles(id) on delete cascade not null,
  outcome text not null check (outcome in ('client_cancelled', 'sick', 'authorised_absence', 'no_show', 'turned_away')),
  note text,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz not null default now(),
  unique (job_id, cleaner_id)
);

create index missed_shift_outcomes_cleaner_id_idx on missed_shift_outcomes(cleaner_id);

alter table missed_shift_outcomes enable row level security;

-- The office decides. A cleaner can see what was recorded against their own
-- shifts - the same openness as a decided claim - and nothing about anyone
-- else's. Supervisors are kept out, as they are from payroll.
create policy "missed_shift_outcomes: admin all" on missed_shift_outcomes
  for all using (is_admin()) with check (is_admin());
create policy "missed_shift_outcomes: self select" on missed_shift_outcomes
  for select using (cleaner_id = auth.uid());

-- The review now holds the close on any missed shift without an outcome, and
-- lists the ones with an outcome so the admin can see what was recorded
-- before locking. Same columns as 0082; close_payroll_period() reads
-- `blocking` from here and needs no change.
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
    -- A claim waiting on the office.
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

    -- A shift the clock disagreed with (0079).
    select 'short_shift'::text, true, j.id, null::uuid, null::text, p.address, j.scheduled_at,
           'Clocked well under the booked time - confirm or correct the hours'::text
    from jobs j
    left join properties p on p.id = j.property_id
    where j.hours_review_needed
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end

    union all

    -- Not finished. After reconcile_job_statuses() this is a job still
    -- running past the period's end, or one whose booked end is later than
    -- now - either way its hours are not settled yet.
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

    -- Nobody clocked in. Held until the office says what happened to each
    -- person on it; listed once they have, so what was recorded is in view
    -- at the moment of closing. A claim pending on the same shift is already
    -- a blocker above, so it is not doubled here.
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

    order by 7;
end;
$$ language plpgsql stable security definer set search_path = public;
