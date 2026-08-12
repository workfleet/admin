-- Notifications: dismissible, with old ones purged after 30 days.
-- No pg_cron / scheduled function is set up for this project, so expiry
-- is enforced lazily by the app itself (see lib/notifications.js) rather
-- than by a background job.
alter table notifications add column if not exists dismissed_at timestamptz;

create policy "notifications: self delete" on notifications
  for delete using (user_id = auth.uid());
