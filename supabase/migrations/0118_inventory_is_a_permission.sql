-- Managing stock stops being a role and becomes a permission.
--
-- 0101 added 'inventory' as a fourth role for someone who counts and reorders
-- stock and does nothing else. That was right for what it described, but a
-- role is a single column, so it could only ever say one thing about a
-- person - and the person who does the stock take also does a shift. He is
-- booked on the rota for it (0113, lib/staffRoles.js), he clocks in for it
-- and he is paid for it, which is what a cleaner is. Being an 'inventory'
-- meant he was kept out of is_staff() by design: no Team Chat, no company
-- documents, no training, and a cleaner app with two of its tabs hidden.
--
-- So the two questions are separated. `role` answers "what is this person to
-- the company", and `manages_inventory` answers "may they touch stock". Ben
-- becomes a cleaner, like everyone else who turns up to a job, and keeps the
-- stock screens because of the flag rather than because of his role.
--
-- The 'inventory' role is deliberately left working: it still grants stock
-- access below, it is still a valid role, and anyone holding it is backfilled
-- with the flag. Nothing that exists today changes behaviour - this only adds
-- a second way to be allowed in. A stock-only person is still a sensible
-- thing to be, and this file does not take that away.

alter table profiles
  add column if not exists manages_inventory boolean not null default false;

comment on column profiles.manages_inventory is
  'May this person count and reorder stock. Independent of role, so a cleaner can do it. Admins and supervisors always can - see can_manage_inventory().';

-- Anyone who holds the stock-only role today keeps exactly what they have.
update profiles set manages_inventory = true where role = 'inventory';

-- Same reach as before, plus the flag. `active` is still required: a
-- deactivated account should not be ordering anything, whatever is ticked.
create or replace function can_manage_inventory() returns boolean as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and active
      and (role in ('admin', 'supervisor', 'inventory') or manages_inventory)
  );
$$ language sql security definer stable set search_path = public;

-- A permission a cleaner could grant themselves is not a permission. The
-- "profiles: self update" policy (0091) lets anyone write their own row, and
-- the guard below is the only thing standing between that and a new column -
-- role and active have been guarded here since 0010/0024/0037 for exactly
-- this reason, and this is the third thing that now belongs in the list.
create or replace function prevent_self_privilege_escalation() returns trigger as $$
begin
  if auth.uid() is not null and not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change role';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only an admin can change active status';
    end if;
    if new.manages_inventory is distinct from old.manages_inventory then
      raise exception 'Only an admin can change who manages stock';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
