-- Tell the client when their cleaner arrives and when they leave.
--
-- The check-in row has always said when each cleaner walked in and out.
-- The client portal showed it as a log after the visit and nothing while
-- it was happening, so "is anyone at my house?" was a phone call to the
-- office. Now the portal shows it live (lib/siteStatus.js), and the client
-- can be told the moment it changes.
--
-- Per client, on by default, switched off from their own Settings. The
-- bell row written here is pushed to the client's phone by the sweep in
-- api/notify (0086) if they have enabled notifications; the arrival email
-- is sent by api/notify from the cleaner's check-in, gated on the same
-- flag.

alter table clients
  add column if not exists arrival_alerts boolean not null default true;

-- Clients could not read the names of the cleaners sent to them: profiles
-- were visible to self, admins, and staff only, so every "Laura" in the
-- client portal came back blank and the pages quietly fell back to "your
-- cleaner". A client may see the name and role of a cleaner assigned to a
-- job at one of their own properties - nothing else about them, and nobody
-- who has never been sent to them.
create policy "profiles: client sees assigned cleaners" on profiles
  for select using (
    id in (
      select ja.cleaner_id
      from job_assignments ja
      join jobs j on j.id = ja.job_id
      where j.property_id in (select client_property_ids())
    )
  );

create or replace function notify_client_on_visit_change() returns trigger as $$
declare
  cleaner_name text;
  addr text;
  client_uuid uuid;
  wants boolean;
  event text;
  at_time timestamptz;
begin
  -- Arrival: a check-in row appearing with a time. Departure: the check-out
  -- time being set where it was null - by the cleaner, by the geofence, or
  -- by the office closing an open shift. Anything else is not news.
  if tg_op = 'INSERT' then
    if new.checked_in_at is null then return new; end if;
    event := 'arrived';
    at_time := new.checked_in_at;
  elsif tg_op = 'UPDATE' then
    if new.checked_out_at is not null and old.checked_out_at is null then
      event := 'finished';
      at_time := new.checked_out_at;
    elsif new.checked_in_at is not null and old.checked_in_at is null then
      event := 'arrived';
      at_time := new.checked_in_at;
    else
      return new;
    end if;
  else
    return new;
  end if;

  select p.address, p.client_id into addr, client_uuid
  from public.jobs j join public.properties p on p.id = j.property_id
  where j.id = new.job_id;
  if client_uuid is null then return new; end if;

  select arrival_alerts into wants from public.clients where id = client_uuid;
  if not coalesce(wants, false) then return new; end if;

  select full_name into cleaner_name from public.profiles where id = new.cleaner_id;

  insert into public.notifications (user_id, message)
  select pr.id,
    coalesce(cleaner_name, 'Your cleaner')
    || case when event = 'arrived' then ' has arrived at ' else ' has finished at ' end
    || coalesce(addr, 'your property')
    || ' (' || to_char(at_time at time zone 'Europe/London', 'HH24:MI') || ')'
  from public.profiles pr
  where pr.client_id = client_uuid and pr.role = 'client';

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists checkins_notify_client on checkins;
create trigger checkins_notify_client
  after insert or update of checked_in_at, checked_out_at on checkins
  for each row execute procedure notify_client_on_visit_change();
