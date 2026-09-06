-- What a cleaner's login could reach that it should not, after a pass over
-- every policy and every callable function on 2026-09-06.
--
-- The serious one is from 0082, the same day. payroll_record_job_change()
-- is the function the payroll triggers call to write an adjustment when a
-- paid job changes. It is SECURITY DEFINER with no check of its own,
-- because the triggers that call it run on behalf of whatever caused the
-- change. But Postgres grants EXECUTE on a new function to PUBLIC, and
-- PostgREST exposes it, so anyone holding the anon key - no login needed -
-- could call it directly with deleting = true and write a negative
-- adjustment against any job whose id they knew. Confirmed by probe. The
-- triggers do not need the grant: inside a definer function the caller is
-- the owner, and the owner keeps EXECUTE whatever is revoked from PUBLIC.

revoke execute on function payroll_record_job_change(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function payroll_paid_minutes(uuid, uuid) from public, anon, authenticated;

-- reconcile_job_statuses() only moves job statuses to where time has
-- already taken them, so a stranger calling it changes nothing that the
-- next admin page load would not. It still has no business being callable
-- without a login.
revoke execute on function reconcile_job_statuses() from public, anon;
grant execute on function reconcile_job_statuses() to authenticated;

-- Client ratings (0052) were readable by every member of staff, including
-- a client's one-line comment about the cleaner. A cleaner can see the
-- ratings on jobs they were on and nobody else's.
drop policy if exists "job_ratings: staff select" on job_ratings;
create policy "job_ratings: staff select" on job_ratings
  for select using (
    is_admin_or_supervisor()
    or exists (
      select 1 from job_assignments ja
      where ja.job_id = job_ratings.job_id and ja.cleaner_id = auth.uid()
    )
  );

-- Property checklists (0054) were readable for every property in the
-- company. A cleaner needs the checklist for the properties they are sent
-- to - cleaner_property_ids() is the same set the properties policy uses.
drop policy if exists "property_checklist_items: staff select" on property_checklist_items;
create policy "property_checklist_items: staff select" on property_checklist_items
  for select using (
    is_admin_or_supervisor()
    or property_id in (select cleaner_property_ids())
  );
