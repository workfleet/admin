-- Closes the loop the other way: right now, acknowledging an alert only
-- clears it from the admin banner - the cleaner who raised it has no
-- way of knowing anyone's seen it. In-app notification here; the push
-- notification to their phone is sent from the API route (app/api/notify)
-- the same way the original alert pushes to admin, since that needs the
-- web-push library which only runs server-side.
create or replace function notify_cleaner_on_emergency_alert_acknowledged() returns trigger as $$
declare
  acknowledger_name text;
begin
  if new.status = 'acknowledged' and old.status is distinct from new.status then
    select full_name into acknowledger_name from profiles where id = new.acknowledged_by;

    insert into notifications (user_id, message)
    values (new.cleaner_id, 'Your emergency alert has been picked up by ' || coalesce(acknowledger_name, 'admin') || ' - help is on the way.');
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger on_emergency_alert_acknowledged
  after update on emergency_alerts
  for each row execute procedure notify_cleaner_on_emergency_alert_acknowledged();
