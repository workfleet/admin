-- Every bell entry reaches a phone, and every event gets a bell entry.
--
-- Notifications grew one event at a time. Some events write a bell row by
-- trigger and nothing else (a kit request, a reschedule request, a client
-- request, a key handed over); some ask api/notify for an email and nothing
-- else (a time-off request, a resolved request, a moved shift); a few do
-- everything. Which channel an event used depended on when it was written,
-- and the person waiting for it could not tell the difference - only that
-- their phone stayed quiet.
--
-- Two changes make this one system. First, the bell becomes the source of
-- truth for push: pushed_at below marks which rows have gone to a phone,
-- and api/notify pushes anything unmarked on every request it handles and
-- whenever anyone's app is open. A trigger writing a bell row is now enough
-- to reach a phone, whichever page caused it. Second, the events that never
-- had a bell row get one.

alter table notifications
  add column if not exists pushed_at timestamptz;

-- Everything already in the bell has been seen or missed long ago. Marking
-- it pushed stops the first sweep sending a month of history to every phone.
update notifications set pushed_at = coalesce(pushed_at, created_at);

create index if not exists notifications_unpushed_idx
  on notifications (created_at)
  where pushed_at is null;

-- ---------------------------------------------------------------------------
-- Events that had no bell entry
-- ---------------------------------------------------------------------------

-- A time-off request, to the office. The decision already goes back to the
-- cleaner (0025); the request itself only ever went by email.
create or replace function notify_office_on_time_off_requested() returns trigger as $$
declare
  requester_name text;
begin
  select full_name into requester_name from public.profiles where id = new.cleaner_id;

  insert into public.notifications (user_id, message)
  select p.id,
    coalesce(requester_name, 'A cleaner') || ' requested '
    || (case when new.type = 'holiday' then 'holiday' else 'time off' end)
    || ' ' || to_char(new.start_date, 'DD Mon')
    || (case when new.end_date <> new.start_date then ' – ' || to_char(new.end_date, 'DD Mon') else '' end)
    || coalesce(' - "' || left(new.reason, 80) || '"', '')
  from public.profiles p
  where p.role in ('admin', 'supervisor');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists time_off_requests_notify_office on time_off_requests;
create trigger time_off_requests_notify_office
  after insert on time_off_requests
  for each row execute procedure notify_office_on_time_off_requested();

-- A kit or issue request marked resolved, to the cleaner who raised it.
create or replace function notify_cleaner_on_staff_request_resolved() returns trigger as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    insert into public.notifications (user_id, message)
    values (new.cleaner_id,
      'The office has dealt with your '
      || (case when new.type = 'kit_topup' then 'kit request' else 'reported issue' end)
      || ': ' || left(new.description, 80));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists staff_requests_notify_resolved on staff_requests;
create trigger staff_requests_notify_resolved
  after update of status on staff_requests
  for each row execute procedure notify_cleaner_on_staff_request_resolved();

-- A shift moved on the rota, to everyone on it. Only future shifts: moving
-- last week's job is a correction to a record, not news to anyone.
create or replace function notify_assignees_on_job_moved() returns trigger as $$
declare
  addr text;
begin
  if new.scheduled_at is distinct from old.scheduled_at
     and new.scheduled_at > now()
     and new.status in ('scheduled', 'in_progress') then
    select address into addr from public.properties where id = new.property_id;

    insert into public.notifications (user_id, message)
    select ja.cleaner_id,
      'Your shift at ' || coalesce(addr, 'a property') || ' has moved to '
      || to_char(new.scheduled_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
      || ' (was ' || to_char(old.scheduled_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI') || ').'
    from public.job_assignments ja
    where ja.job_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists jobs_notify_moved on jobs;
create trigger jobs_notify_moved
  after update of scheduled_at on jobs
  for each row execute procedure notify_assignees_on_job_moved();

-- A message from a client, to the office. Their replies already reach the
-- client by email; the client's own message only ever did.
create or replace function notify_office_on_client_message() returns trigger as $$
declare
  client_name text;
begin
  if new.sender = 'client' then
    select name into client_name from public.clients where id = new.client_id;

    insert into public.notifications (user_id, message)
    select p.id,
      coalesce(client_name, 'A client') || ' sent a message: '
      || left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 90)
    from public.profiles p
    where p.role in ('admin', 'supervisor');
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists client_messages_notify_office on client_messages;
create trigger client_messages_notify_office
  after insert on client_messages
  for each row execute procedure notify_office_on_client_message();
