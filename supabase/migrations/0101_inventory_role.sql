-- A fourth staff role, 'inventory', for someone who counts and reorders
-- stock and does nothing else (first needed 2026-09-17). Every existing
-- role carries more than that: a cleaner sees their jobs, the rota and Team
-- Chat; a supervisor runs the whole office. The app sends this role straight
-- to /admin/inventory and shows it no other link; this file is the half
-- that holds when someone types a URL by hand.
--
-- No other policy names the role, so every other table stays closed to it.
-- It is deliberately NOT added to is_staff(): no staff-directory read, no
-- automatic Team Chat membership. Its own profile row is still readable
-- through "profiles: self or admin", which the login gate needs.

alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'supervisor', 'cleaner', 'client', 'inventory'));

create or replace function can_manage_inventory() returns boolean as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('admin', 'supervisor', 'inventory') and active
  );
$$ language sql security definer stable set search_path = public;

-- Same reach as before for admins and supervisors; the inventory role joins
-- them. Cleaners keep their read-only "products: staff select" (0053).
drop policy if exists "products: admin or supervisor manage" on products;
drop policy if exists "products: inventory manage" on products;
create policy "products: inventory manage" on products
  for all using (can_manage_inventory());
