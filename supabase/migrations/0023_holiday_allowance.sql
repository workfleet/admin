-- Annual holiday allowance per cleaner. Days used is calculated on the
-- fly from approved 'holiday' time_off_requests (not stored/denormalized,
-- so it can never drift out of sync) - see app code. Admin sets/edits the
-- allowance; there's no automatic yearly reset/carryover yet, it's a
-- simple running balance.
alter table profiles add column holiday_allowance_days numeric(5,1) not null default 28;

-- "profiles: self update" has no column-level restriction, so without
-- this a cleaner could PATCH their own holiday_allowance_days straight
-- through the API - same class of bug prevent_self_privilege_escalation
-- (0010) already closed for role/active, just extended to cover this too.
create or replace function prevent_self_privilege_escalation() returns trigger as $$
begin
  if not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change role';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only an admin can change active status';
    end if;
    if new.holiday_allowance_days is distinct from old.holiday_allowance_days then
      raise exception 'Only an admin can change holiday allowance';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;
