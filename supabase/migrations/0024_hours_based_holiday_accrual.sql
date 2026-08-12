-- Switches holiday tracking from an admin-set flat number of days to the
-- UK 12.07% accrual method (5.6 statutory weeks / 46.4 working weeks),
-- which is specifically meant for workers with variable/irregular hours
-- like these cleaners. Accrued hours = hours worked on completed jobs *
-- 0.1207, calculated on the fly in app code (not stored, so it's always
-- current). "Hours worked" uses each job's duration_minutes rather than
-- checkin/checkout timestamps, since checkout is sometimes never
-- recorded and duration_minutes is always present.
--
-- holiday_adjustment_hours replaces holiday_allowance_days as the one
-- thing admin still sets directly - a manual correction on top of the
-- computed accrual (e.g. carried-over service from before this system
-- existed), not the allowance itself.
alter table profiles drop column holiday_allowance_days;
alter table profiles add column holiday_adjustment_hours numeric(6,2) not null default 0;

-- Requests now carry the actual hours being taken, not just a date
-- range - the date range stays for calendar/rota context, but the hours
-- figure is what actually gets deducted from the balance.
alter table time_off_requests add column hours numeric(6,2);

create or replace function prevent_self_privilege_escalation() returns trigger as $$
begin
  if not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change role';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only an admin can change active status';
    end if;
    if new.holiday_adjustment_hours is distinct from old.holiday_adjustment_hours then
      raise exception 'Only an admin can change holiday adjustment';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;
