-- Lets a property store coordinates captured from the address-autocomplete
-- picker (Clients page), so job detail views can show a map + directions
-- link for the cleaner heading there.
alter table properties
  add column if not exists lat double precision,
  add column if not exists lng double precision;
