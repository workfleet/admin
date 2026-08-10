-- Fix: infinite recursion in RLS between "jobs" and "properties" policies.
-- The "properties: cleaner via job" policy queries jobs, and the
-- "jobs: client own properties" policy queries properties -> circular.
-- Wrapping each cross-table lookup in a security definer function (same
-- pattern already used for is_admin()) makes the inner query run with the
-- function owner's privileges, bypassing RLS, and breaking the cycle.

create or replace function cleaner_property_ids() returns setof uuid as $$
  select property_id from jobs where cleaner_id = auth.uid()
$$ language sql security definer stable;

create or replace function client_property_ids() returns setof uuid as $$
  select p.id from properties p
  join profiles pr on pr.client_id = p.client_id
  where pr.id = auth.uid()
$$ language sql security definer stable;

drop policy if exists "properties: cleaner via job" on properties;
create policy "properties: cleaner via job" on properties
  for select using (id in (select cleaner_property_ids()));

drop policy if exists "jobs: client own properties" on jobs;
create policy "jobs: client own properties" on jobs
  for select using (property_id in (select client_property_ids()));
