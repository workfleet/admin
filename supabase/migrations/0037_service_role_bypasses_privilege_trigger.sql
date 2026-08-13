-- prevent_self_privilege_escalation() (0010, redefined in 0024) gates role/
-- active/holiday changes on is_admin(), which checks auth.uid() against
-- profiles. Service-role requests have no auth.uid() (it's null), so the
-- trigger was blocking them too - not just self-escalation by a logged-in
-- user. That silently broke the "Add Staff" flow's promotion of a new
-- account to role='supervisor' (the update was rejected, and the calling
-- route didn't check for the error, so the account just stayed 'cleaner').
--
-- RLS already restricts which rows a request can reach here (self, or an
-- admin via "profiles: admin update") - service-role requests bypass RLS
-- entirely because the key is a trusted backend-only secret, so this
-- trigger should trust them the same way, not re-block them after the
-- fact. auth.uid() is null only for service-role/direct-SQL callers -
-- every RLS-permitted UPDATE path has a real auth.uid() by construction.

create or replace function prevent_self_privilege_escalation() returns trigger as $$
begin
  if auth.uid() is not null and not is_admin() then
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
$$ language plpgsql security definer set search_path = public;
