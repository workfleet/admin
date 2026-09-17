-- The Inventory page says who last counted each product (0100), and the
-- inventory-only account (0101) is the person most often looking at it.
-- Under 0101 that account can read only its own profile row, so every other
-- name on the page comes back empty and the "by" line goes missing.
--
-- Staff names only - admin, supervisor, cleaner, inventory - never a
-- client's, and the same rows the staff directory (0021) already shows every
-- cleaner. Through a definer helper, as the other role checks are, so the
-- policy does not re-enter profiles and loop (0091).

create or replace function is_inventory_role() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'inventory'
  );
$$ language sql security definer stable set search_path = public;

revoke execute on function is_inventory_role() from public;
grant execute on function is_inventory_role() to anon, authenticated;

drop policy if exists "profiles: inventory sees staff names" on profiles;
create policy "profiles: inventory sees staff names" on profiles
  for select using (is_inventory_role() and role in ('admin', 'supervisor', 'cleaner', 'inventory'));
