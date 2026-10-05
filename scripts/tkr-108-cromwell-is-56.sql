-- One-off (2026-10-05): the TKR property recorded as "108 Cromwell street,
-- Swansea SA1 6HA" is really 56 Cromwell Street, per Jess and TKR's HMO
-- sheet. It has jobs booked from 7 October, so cleaners must be sent to
-- the right door.
--
-- It also has no map pin, so clock-in has no location to check against.
-- The older "56 Cromwell Street, SA1 6AH" record (one past visit, cleaners
-- clocked in fine there) has one, and it is copied across.
--
-- on_property_self_update (0061) blocks address and pin changes from this
-- editor, so it is switched off for the one statement.
begin;

alter table properties disable trigger on_property_self_update;

update properties p
set address = '56 Cromwell Street, Swansea, SA1 6HA',
    lat = old.lat,
    lng = old.lng
from properties old
where p.id = '075fefec-1093-4ea3-8057-95a0ad2b8ef1'
  and p.address = '108 Cromwell street, Swansea SA1 6HA'
  and old.id = '3ec8062b-230a-48e6-9af4-30bd730c6d5a';

alter table properties enable trigger on_property_self_update;

commit;

-- Should show the renamed record with a pin, and the older record beside it.
select id, address, lat, lng from properties
where client_id = '10a80ca8-3185-4196-aae8-a6b1be35b942' and address ilike '%cromwell%';
