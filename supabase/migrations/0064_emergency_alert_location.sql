-- Attaches the cleaner's last known location to an emergency alert,
-- pulled from checkins.lat/lng (captured by the browser's geolocation
-- API when they clocked in - see app/cleaner/jobs/[id]/page.js) rather
-- than asking for a fresh GPS fix at alert time, which would add a
-- permission prompt and delay to the one moment that can least afford
-- either. Prefers a checkin they haven't clocked out of yet (still
-- on-site) over an older completed one.
alter table emergency_alerts
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists checkin_id uuid references checkins(id) on delete set null,
  add column if not exists checkin_at timestamptz;

create or replace function attach_checkin_location_to_emergency_alert() returns trigger as $$
declare
  latest_checkin checkins%rowtype;
begin
  select * into latest_checkin
  from checkins
  where cleaner_id = new.cleaner_id and lat is not null and lng is not null
  order by (checked_out_at is null) desc, checked_in_at desc
  limit 1;

  if found then
    new.lat := latest_checkin.lat;
    new.lng := latest_checkin.lng;
    new.checkin_id := latest_checkin.id;
    new.checkin_at := latest_checkin.checked_in_at;
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger before_emergency_alert_insert
  before insert on emergency_alerts
  for each row execute procedure attach_checkin_location_to_emergency_alert();
