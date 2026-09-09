-- URGENT: 0094 broke every page that names a cleaner through a job.
--
-- job_assignments.paid_minutes_set_by (0094) was declared with a foreign key
-- to profiles. That gave job_assignments two relationships to profiles -
-- cleaner_id and paid_minutes_set_by - and PostgREST refuses an embed it
-- cannot disambiguate: every `job_assignments(cleaner_id, profiles(full_name))`
-- in the app (dashboard, rota, requests, cover, the client portal) has
-- returned "more than one relationship was found" since the moment 0094
-- ran. The staff_details probe on 2026-09-08 showed the same failure mode
-- and it was not recognised as a rule.
--
-- Dropping the constraint restores the single relationship. The column
-- stays: it is an audit field, and who set a figure does not need
-- referential integrity to be useful. Rule from here on: a table the app
-- embeds profiles through gets exactly one foreign key to profiles.

alter table job_assignments
  drop constraint if exists job_assignments_paid_minutes_set_by_fkey;

-- While here: supervisors decide claims, confirm shifts as worked and
-- correct short shifts (0035, 0078, 0079), so on Requests they should be
-- able to record why a missed shift went unpaid too. 0093 left this
-- admin-only, matching the payroll page it was decided on; the decision
-- now lives on Requests with the rest.
drop policy if exists "missed_shift_outcomes: admin all" on missed_shift_outcomes;
create policy "missed_shift_outcomes: office all" on missed_shift_outcomes
  for all using (is_admin_or_supervisor()) with check (is_admin_or_supervisor());
