-- Office-entered access details per property: alarm codes, key safe and
-- keypad codes, where the key is kept, how to disarm on the way in.
--
-- Kept separate from properties.notes (general internal notes) and from
-- properties.client_access_notes (what the client typed in their own
-- portal, 0061) so the office can see at a glance which is which, and so
-- data-retention redaction can clear both access columns without touching
-- the notes. The cleaner job page shows this column and the client's
-- note together under "How to get in".
--
-- Clients can read it for their own property (their own codes) but must
-- not change it - the 0061 column allow-list trigger is extended so a
-- client update that touches it is rejected, the same as address/notes.
alter table properties add column if not exists access_details text;

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
  then
    raise exception 'Clients may only update client_access_notes';
  end if;

  return new;
end;
$$ language plpgsql security definer;
