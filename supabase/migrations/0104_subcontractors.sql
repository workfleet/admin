-- Some cleaners are subcontractors: they invoice for their hours and do not
-- accrue holiday, so a holiday balance on their rota is wrong and a holiday
-- request from them has nothing to draw on. The office marks them on the
-- person's page; everyone else stays an employee, which is what every
-- existing row already means.
--
-- On profile_private (0088) rather than profiles: the office sets it, and a
-- cleaner can read their own row under the select policy there, which is
-- all their rota needs to hide the balance. The admin-write policy already
-- stops a cleaner changing it themselves.
alter table profile_private
  add column if not exists employment_type text not null default 'employee'
    check (employment_type in ('employee', 'subcontractor'));

-- The balance check (0094) is the one gate a holiday request passes even
-- when the form is bypassed, so it is where a subcontractor's request is
-- refused outright. Everything else is 0094 as it was.
create or replace function enforce_holiday_balance() returns trigger as $$
declare
  worked_hours numeric;
  adjustment numeric;
  employment text;
  accrued numeric;
  committed numeric;
begin
  if new.type <> 'holiday' then
    return new;
  end if;

  select coalesce(holiday_adjustment_hours, 0), employment_type into adjustment, employment
  from profile_private where profile_id = new.cleaner_id;
  adjustment := coalesce(adjustment, 0);

  if employment = 'subcontractor' then
    raise exception 'Subcontractors do not accrue holiday, so a holiday request cannot be made';
  end if;

  select coalesce(sum(assignment_paid_minutes(ja.job_id, ja.cleaner_id)), 0) / 60.0 into worked_hours
  from job_assignments ja
  where ja.cleaner_id = new.cleaner_id;

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
