-- Auto-transitions jobs based on elapsed time, not just check-in/out
-- events: a scheduled job nobody checked into by the time it should have
-- finished is marked missed; an in-progress job that's run past its
-- allocated time auto-completes even without an explicit check-out.
-- There's no cron/scheduled-job infrastructure in this project (see
-- lib/notifications.js's purge-on-load comment for the same reasoning),
-- so this runs lazily whenever the admin Rota or Dashboard loads rather
-- than on a timer - close enough for a small crew checking the app
-- throughout the day, without needing external scheduling.
create or replace function reconcile_job_statuses() returns void as $$
begin
  update jobs
  set status = 'missed'
  where status = 'scheduled'
    and scheduled_at + (duration_minutes || ' minutes')::interval < now()
    and not exists (
      select 1 from checkins c where c.job_id = jobs.id and c.checked_in_at is not null
    );

  update jobs
  set status = 'completed'
  where status = 'in_progress'
    and scheduled_at + (duration_minutes || ' minutes')::interval < now();
end;
$$ language plpgsql security definer;

grant execute on function reconcile_job_statuses() to authenticated;
