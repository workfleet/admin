-- Time off requests already default to 'pending' and require an admin
-- decision (time_off_requests, 0022), and that decision already emails
-- the cleaner (app/api/notify). What's missing is the same in-app
-- notification-feed entry every other admin action gets - same pattern
-- as notify_on_job_assignment (schema.sql) and
-- notify_admins_on_kit_request (0016).
create or replace function notify_cleaner_on_time_off_decided() returns trigger as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'declined') then
    insert into notifications (user_id, message)
    values (
      new.cleaner_id,
      'Your ' || (case when new.type = 'holiday' then 'holiday' else 'unavailability' end)
        || ' request for ' || to_char(new.start_date, 'DD Mon') || '–' || to_char(new.end_date, 'DD Mon')
        || ' was ' || new.status || '.'
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger time_off_requests_notify_cleaner
  after update on time_off_requests
  for each row execute procedure notify_cleaner_on_time_off_decided();
