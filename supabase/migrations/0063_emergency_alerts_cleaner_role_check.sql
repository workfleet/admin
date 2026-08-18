-- is_active_cleaner() (0009) only checks profiles.active, not role - it
-- was named for its original use (cleaner-only write paths already
-- scoped to cleaner_id = auth.uid()), but on emergency_alerts it let
-- any active, non-cleaner role (client, admin, supervisor) also raise
-- an alert, since nothing else in that policy checked role. A safety
-- feature that can be triggered by the wrong role is worse than
-- useless - false alarms erode trust in real ones. Live-tested: a
-- signed-in test client could insert a row here before this fix.
drop policy if exists "emergency_alerts: cleaner insert own" on emergency_alerts;
create policy "emergency_alerts: cleaner insert own" on emergency_alerts
  for insert with check (
    cleaner_id = auth.uid()
    and is_active_cleaner()
    and exists (select 1 from profiles where id = auth.uid() and role = 'cleaner')
  );
