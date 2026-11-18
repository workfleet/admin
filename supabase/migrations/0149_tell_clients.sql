-- Tell clients when the office does something for them.
--
-- A client only found out we'd replied, sent a quote, sorted a request or
-- decided a reschedule or pause the next time they signed in: the office's
-- reply went by email only, and email is still in test mode (Resend
-- sandbox), so in practice they heard nothing. Each of these now writes a
-- bell entry for every active login at that client. The bell shows on the
-- portal dashboard under Recent updates, and the existing push sweep
-- (0086, api/notify) sends it to any phone that has notifications on.

create or replace function notify_client_logins(p_client_id uuid, p_message text) returns void as $$
  insert into public.notifications (user_id, message)
  select p.id, p_message
  from public.profiles p
  where p.client_id = p_client_id and p.role = 'client' and p.active is not false;
$$ language sql security definer set search_path = public;

revoke execute on function notify_client_logins(uuid, text) from public, anon, authenticated;

-- A reply from the office.
create or replace function notify_client_on_office_message() returns trigger as $$
begin
  if new.sender = 'admin' then
    perform notify_client_logins(new.client_id,
      'New message from CrewConnect: ' || left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 90));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function notify_client_on_office_message() from public, anon, authenticated;

drop trigger if exists client_messages_notify_client on client_messages;
create trigger client_messages_notify_client
  after insert on client_messages
  for each row execute procedure notify_client_on_office_message();

-- A request, problem report, supplies or extra-work request marked sorted.
create or replace function notify_client_on_request_resolved() returns trigger as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    perform notify_client_logins(new.client_id,
      case new.kind
        when 'problem' then 'We''ve looked into the problem you reported'
        when 'supplies' then 'Your supplies request is sorted'
        when 'extra_work' then 'We''ve replied to your request for extra work'
        else 'Your request is sorted'
      end
      || ': ' || left(coalesce(nullif(new.resolution_note, ''), new.description), 90));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function notify_client_on_request_resolved() from public, anon, authenticated;

drop trigger if exists client_requests_notify_client on client_requests;
create trigger client_requests_notify_client
  after update of status on client_requests
  for each row execute procedure notify_client_on_request_resolved();

-- A quote marked Sent, for a client (not a prospect).
create or replace function notify_client_on_quote_sent() returns trigger as $$
begin
  if new.client_id is not null and new.status = 'sent' and old.status is distinct from 'sent' and new.archived_at is null then
    perform notify_client_logins(new.client_id,
      'We''ve sent you a quote - see Quotes to accept it: ' || left(coalesce(new.description, ''), 80));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function notify_client_on_quote_sent() from public, anon, authenticated;

drop trigger if exists quotes_notify_client on quotes;
create trigger quotes_notify_client
  after update of status on quotes
  for each row execute procedure notify_client_on_quote_sent();

-- A quote created already marked Sent.
drop trigger if exists quotes_notify_client_insert on quotes;
create or replace function notify_client_on_quote_inserted_sent() returns trigger as $$
begin
  if new.client_id is not null and new.status = 'sent' and new.archived_at is null then
    perform notify_client_logins(new.client_id,
      'We''ve sent you a quote - see Quotes to accept it: ' || left(coalesce(new.description, ''), 80));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function notify_client_on_quote_inserted_sent() from public, anon, authenticated;

create trigger quotes_notify_client_insert
  after insert on quotes
  for each row execute procedure notify_client_on_quote_inserted_sent();

-- A reschedule request decided.
create or replace function notify_client_on_reschedule_decided() returns trigger as $$
begin
  if new.status in ('approved', 'declined') and old.status = 'pending' then
    perform notify_client_logins(new.client_id,
      case when new.status = 'approved'
        then 'Your visit has been moved to ' || to_char(new.requested_scheduled_at at time zone 'Europe/London', 'Dy DD Mon, HH24:MI')
        else 'We couldn''t move your visit to the time you asked for' || coalesce(' - ' || nullif(new.admin_note, ''), '')
      end);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function notify_client_on_reschedule_decided() from public, anon, authenticated;

drop trigger if exists reschedule_requests_notify_client on reschedule_requests;
create trigger reschedule_requests_notify_client
  after update of status on reschedule_requests
  for each row execute procedure notify_client_on_reschedule_decided();

-- A pause request decided.
create or replace function notify_client_on_pause_decided() returns trigger as $$
begin
  if new.status in ('approved', 'declined') and old.status = 'pending' then
    perform notify_client_logins(new.client_id,
      case when new.status = 'approved'
        then 'Your cleans are paused from ' || to_char(new.start_date, 'DD Mon') || ' to ' || to_char(new.end_date, 'DD Mon')
        else 'We couldn''t pause your cleans for those dates' || coalesce(' - ' || nullif(new.admin_note, ''), '')
      end);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function notify_client_on_pause_decided() from public, anon, authenticated;

drop trigger if exists client_pause_requests_notify_client on client_pause_requests;
create trigger client_pause_requests_notify_client
  after update of status on client_pause_requests
  for each row execute procedure notify_client_on_pause_decided();
