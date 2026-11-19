-- 0150: every room refreshed on every fortnightly visit, and proof of it.
--
-- TKR Management (Nov 2026) want each HMO's communal areas cleaned and every
-- room refreshed once a fortnight. Until now a refresh was a one-off booking
-- or a line in the job notes, and nothing knew which rooms a house had - so
-- Slate Street had Room 2 done twice in three days and others not at all,
-- and the invoice had to be argued over.
--
-- properties.rooms         the rooms in the house, e.g. {Room 1,Room 2,...}.
--                          Empty means the property isn't tracked.
-- properties.rooms_tracked_since
--                          the first visit date the list applies to. Visits
--                          before it are invoiced the old way, so setting up
--                          a room list never rewrites a past invoice.
-- clients.room_refresh_minutes
--                          booked time allowed (and charged) per room. Blank
--                          means 15 minutes.
--
-- A cleaner ticks a room on the job with set_room_refresh(). The tick is
-- written into jobs.room_refreshes (0126), which the invoice already reads,
-- so a ticked room is charged and an unticked one isn't.

alter table properties add column if not exists rooms text[] not null default '{}';
alter table properties add column if not exists rooms_tracked_since date;

alter table clients add column if not exists room_refresh_minutes integer;
alter table clients drop constraint if exists clients_room_refresh_minutes_range;
alter table clients add constraint clients_room_refresh_minutes_range
  check (room_refresh_minutes is null or room_refresh_minutes between 5 and 240);

-- Clients can update their own property (0061) and client row; neither may
-- change the room list or the time charged per room. Same functions as 0097
-- and 0126, with the new columns added.
create or replace function enforce_property_self_update_columns() returns trigger as $$
begin
  if is_admin_or_supervisor() then
    return new;
  end if;

  if new.address is distinct from old.address
     or new.notes is distinct from old.notes
     or new.access_details is distinct from old.access_details
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng
     or new.geofence_radius_m is distinct from old.geofence_radius_m
     or new.client_id is distinct from old.client_id
     or new.rooms is distinct from old.rooms
     or new.rooms_tracked_since is distinct from old.rooms_tracked_since
  then
    raise exception 'Clients may only update client_access_notes';
  end if;

  return new;
end;
$$ language plpgsql security definer;

create or replace function enforce_client_self_update_columns() returns trigger as $$
begin
  if is_admin_or_supervisor() then
    return new;
  end if;

  if new.name is distinct from old.name
     or new.notes is distinct from old.notes
     or new.industry is distinct from old.industry
     or new.contract_value is distinct from old.contract_value
     or new.contract_renewal_date is distinct from old.contract_renewal_date
     or new.contract_notice_days is distinct from old.contract_notice_days
     or new.detailed_reports is distinct from old.detailed_reports
     or new.hourly_rate is distinct from old.hourly_rate
     or new.room_refresh_minutes is distinct from old.room_refresh_minutes
  then
    raise exception 'Clients may only update contact_name, email, phone, and billing_address';
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- Ticks (is_done true) or unticks one room on a visit. Cleaners may only
-- tick rooms on a visit they're assigned to and that hasn't been closed;
-- the office can correct any visit. The room has to be on the property's
-- list, and the minutes come from the client, so a cleaner can't change
-- what is charged. Returns the visit's new list.
create or replace function set_room_refresh(target_job_id uuid, room_name text, is_done boolean)
returns jsonb as $$
declare
  job_status text;
  current_list jsonb;
  house_rooms text[];
  per_room integer;
  office boolean := is_admin_or_supervisor();
  new_list jsonb;
begin
  select j.status, j.room_refreshes, p.rooms, coalesce(c.room_refresh_minutes, 15)
    into job_status, current_list, house_rooms, per_room
  from jobs j
  join properties p on p.id = j.property_id
  left join clients c on c.id = p.client_id
  where j.id = target_job_id;

  if not found then
    raise exception 'That visit no longer exists';
  end if;

  if not office then
    if not exists (select 1 from job_assignments where job_id = target_job_id and cleaner_id = auth.uid()) then
      raise exception 'This visit is not on your rota';
    end if;
    if job_status not in ('scheduled', 'in_progress') then
      raise exception 'This visit is finished - ask the office to change it';
    end if;
  end if;

  if room_name is null or not (room_name = any(house_rooms)) then
    raise exception 'That room is not on this property''s room list';
  end if;

  select coalesce(jsonb_agg(e.item), '[]'::jsonb) into new_list
  from jsonb_array_elements(coalesce(current_list, '[]'::jsonb)) as e(item)
  where e.item->>'room' is distinct from room_name;

  if is_done then
    new_list := new_list || jsonb_build_array(jsonb_build_object(
      'room', room_name,
      'minutes', per_room,
      'done_at', now(),
      'done_by', auth.uid()
    ));
  end if;

  update jobs set room_refreshes = new_list where id = target_job_id;
  return new_list;
end;
$$ language plpgsql security definer set search_path = public;

-- Definer functions are callable by anyone with the anon key unless revoked.
revoke all on function set_room_refresh(uuid, text, boolean) from public;
revoke all on function set_room_refresh(uuid, text, boolean) from anon;
grant execute on function set_room_refresh(uuid, text, boolean) to authenticated;
