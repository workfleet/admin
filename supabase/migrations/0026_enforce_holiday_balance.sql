-- Staff can already see their accrued/remaining holiday balance in the
-- app, but nothing stopped them submitting a request for more hours than
-- they actually have. This enforces it at the database level (not just
-- client-side validation, which could be bypassed by hitting the API
-- directly) - mirrors the same 12.07%-of-hours-worked formula used
-- throughout the app (cleaner Rota, admin Cleaners, admin Requests).
--
-- Counts both already-approved AND still-pending requests against the
-- balance, so a cleaner can't submit several overlapping requests that
-- would only individually look affordable.
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

  select coalesce(sum(duration_minutes), 0) / 60.0 into worked_hours
  from jobs where cleaner_id = new.cleaner_id and status = 'completed';

  select coalesce(holiday_adjustment_hours, 0) into adjustment
  from profiles where id = new.cleaner_id;

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

create trigger time_off_requests_enforce_balance
  before insert on time_off_requests
  for each row execute procedure enforce_holiday_balance();
