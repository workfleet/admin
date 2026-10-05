-- One-off (2026-10-05): map pins for two TKR properties that never had one,
-- so clock-in can check the cleaner is there, plus directions to Elba
-- Crescent from Jess.
--
-- OpenStreetMap's address search (what the app uses) knows neither street,
-- so both pins are the postcode's own point (postcodes.io):
--   SA1 8QQ - lands on Elba Crescent itself.
--   SA1 8BJ - lands on Mackworth Terrace, St Thomas, the street the terrace
--             sits off. If it's out by more than the 75m fence, the cleaner
--             gets "I'm at the property", which clocks them in and proposes
--             where they're standing as the better pin.
--
-- on_property_self_update (0061) blocks pin and notes changes from this
-- editor, so it is switched off for these statements.
begin;

alter table properties disable trigger on_property_self_update;

update properties set lat = 51.620565, lng = -3.880623
where id = '4e53a2e5-bb3a-4add-9877-ed924450b112' and lat is null;  -- 14 Elba Crescent

update properties set lat = 51.623814, lng = -3.929791
where id = 'c05290ff-b3eb-4216-95e1-cf8d2f40d224' and lat is null;  -- 1 Rosewood Terrace

update properties
set notes = notes || E'\n\nDirections: drive to the set of lights by Bay Studios, then turn left.'
where id = '4e53a2e5-bb3a-4add-9877-ed924450b112'
  and coalesce(notes, '') not like '%Bay Studios%';

alter table properties enable trigger on_property_self_update;

commit;

select address, lat, lng, notes from properties
where id in ('4e53a2e5-bb3a-4add-9877-ed924450b112', 'c05290ff-b3eb-4216-95e1-cf8d2f40d224');
