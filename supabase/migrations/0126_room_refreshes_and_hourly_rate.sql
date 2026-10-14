-- 0126: room refreshes on a job, and what a client is charged per hour.
--
-- TKR Management want each monthly invoice to list every property with its
-- visit dates, and room refreshes separately with the room and the date.
-- Until now a refresh was only extra time on a normal TKR visit, told to
-- the cleaner in Messages, so nothing recorded which room or when.
--
-- room_refreshes holds the rooms refreshed on that visit and the minutes of
-- the booked time each took, e.g. [{"room": "Room 1", "minutes": 60}]. The
-- rest of the booked time is the ordinary clean. A list rather than one
-- column because a move-out can mean two rooms on the same visit.
--
-- hourly_rate is what the client is charged an hour (TKR: 24.00). The
-- invoice breakdown page multiplies booked hours by it.

alter table jobs
  add column if not exists room_refreshes jsonb not null default '[]'::jsonb;

alter table jobs
  drop constraint if exists jobs_room_refreshes_is_array;
alter table jobs
  add constraint jobs_room_refreshes_is_array check (jsonb_typeof(room_refreshes) = 'array');

alter table clients
  add column if not exists hourly_rate numeric(10,2);

-- Before the guard below: the SQL editor isn't an admin session, so once
-- hourly_rate is guarded this update would be refused.
update clients set hourly_rate = 24.00
where name = 'TKR Management' and hourly_rate is null;

-- Clients can update their own row (0061), and any column not listed here
-- is theirs to change - so without this line a client could set their own
-- rate. Same function as 0122, one more line.
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
  then
    raise exception 'Clients may only update contact_name, email, phone, and billing_address';
  end if;

  return new;
end;
$$ language plpgsql security definer;
