-- The stock take is now booked on the rota as a paid hour (lib/staffRoles.js),
-- so the person who does it turns up alone at a site, on a Saturday, with the
-- same phone in their hand as everyone else. The emergency button is in that
-- app, and 0063 narrowed the insert to role = 'cleaner' - which at the time
-- meant "only staff who go out to jobs", and now leaves a lone worker with a
-- panic button that fails.
--
-- Widened to the roles that can be put on a job. 0063's point stands and is
-- kept: a client or an admin still cannot raise an alert, so a false alarm
-- can only come from someone who was actually sent somewhere.
--
-- Nothing else needs a role added. The job, check-in, photo and task
-- policies all go through is_active_cleaner() (0009), which only asks
-- whether the profile is active, so they already hold for this role;
-- is_staff() (0021, 0035) is deliberately left alone, which keeps the
-- inventory role out of the staff directory, Team Chat, company documents
-- and training exactly as 0101 intended.
drop policy if exists "emergency_alerts: cleaner insert own" on emergency_alerts;
create policy "emergency_alerts: cleaner insert own" on emergency_alerts
  for insert with check (
    cleaner_id = auth.uid()
    and is_active_cleaner()
    and exists (
      select 1 from profiles
      where id = auth.uid() and role in ('cleaner', 'inventory')
    )
  );
