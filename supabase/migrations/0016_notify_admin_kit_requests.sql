-- Notifies every admin when a cleaner submits a kit top-up request, same
-- pattern as the existing "cleaner assigned a shift" trigger.
create or replace function notify_admins_on_kit_request() returns trigger as $$
declare
  requester_name text;
begin
  if new.type = 'kit_topup' then
    select full_name into requester_name from profiles where id = new.cleaner_id;

    insert into notifications (user_id, message)
    select id, coalesce(requester_name, 'A cleaner') || ' requested a kit top-up: ' || new.description
    from profiles where role = 'admin';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_kit_request_created
  after insert on staff_requests
  for each row execute procedure notify_admins_on_kit_request();
