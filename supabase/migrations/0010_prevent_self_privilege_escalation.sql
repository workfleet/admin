-- "profiles: self update" (schema.sql) lets a user update their own row,
-- but RLS only governs *which row* can be touched, not *which columns*.
-- Nothing was stopping a cleaner from PATCHing their own profile to set
-- active=true (undoing an admin's deactivation) or role='admin'
-- (self-promoting). A trigger can see OLD vs NEW cleanly, unlike a plain
-- RLS policy, so enforce it there.

create or replace function prevent_self_privilege_escalation() returns trigger as $$
begin
  if not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change role';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only an admin can change active status';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger profiles_prevent_self_privilege_escalation
  before update on profiles
  for each row execute procedure prevent_self_privilege_escalation();
