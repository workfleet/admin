-- Detailed reports, first for TKR Management's lets.
--
-- Two things a letting agent asks for that the three-paragraph report
-- (0012) can't give them:
--
-- 1. A visit written up room by room. job_reports.rooms holds one entry per
--    room - its condition, what was done, anything wrong, and which of the
--    visit's photos show it - so the portal and the PDF can lay each room
--    out with its own pictures. Null on every report written before this,
--    and on any report not using the room-by-room template.
--
-- 2. A monthly report per property, which is built when it is read from the
--    jobs, check-ins and shared reports already stored, so it needs no table
--    of its own. clients.detailed_reports turns it on for a client: it puts
--    "Reports" in their portal and starts their jobs on the room-by-room
--    template. Off for everyone but TKR.

alter table job_reports add column if not exists rooms jsonb;

alter table clients add column if not exists detailed_reports boolean not null default false;

update clients set detailed_reports = true where name = 'TKR Management';

-- The client self-update guard (0061) lists the columns a client may not
-- change. A new column is changeable until it is added to that list, so a
-- client could switch their own reports on. Same function, one more line.
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
  then
    raise exception 'Clients may only update contact_name, email, phone, and billing_address';
  end if;

  return new;
end;
$$ language plpgsql security definer;
