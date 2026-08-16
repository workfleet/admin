-- Lets clients edit a subset of their own contact details, and add
-- entry/alarm-code notes per property that flow through to admin and
-- the assigned cleaner. client_access_notes is a separate column from
-- the existing admin-only properties.notes field so client-submitted
-- access info is never confused with internal notes, or vice versa.
--
-- RLS alone only restricts which ROWS a client can touch, not which
-- COLUMNS (admin and client both sit under the same `authenticated`
-- Postgres role, so column GRANTs can't tell them apart) - a trigger on
-- each table enforces the column allow-list for non-admins.

-- CLIENTS: self-service contact detail updates -----------------------
create policy "clients: client update own" on clients
  for update using (id in (select client_id from profiles where id = auth.uid()))
  with check (id in (select client_id from profiles where id = auth.uid()));

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
  then
    raise exception 'Clients may only update contact_name, email, phone, and billing_address';
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger on_client_self_update
  before update on clients
  for each row execute procedure enforce_client_self_update_columns();

-- PROPERTIES: client-entered access notes (alarm codes, entry info) --
alter table properties add column if not exists client_access_notes text;

create policy "properties: client update own access notes" on properties
  for update using (client_id in (select client_id from profiles where id = auth.uid()))
  with check (client_id in (select client_id from profiles where id = auth.uid()));

create or replace function enforce_property_self_update_columns() returns trigger as $$
begin
  if is_admin_or_supervisor() then
    return new;
  end if;

  if new.address is distinct from old.address
     or new.notes is distinct from old.notes
     or new.lat is distinct from old.lat
     or new.lng is distinct from old.lng
     or new.client_id is distinct from old.client_id
  then
    raise exception 'Clients may only update client_access_notes';
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger on_property_self_update
  before update on properties
  for each row execute procedure enforce_property_self_update_columns();
