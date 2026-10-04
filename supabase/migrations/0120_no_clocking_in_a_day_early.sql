-- Refuse a clock-in more than an hour before the shift it is for.
--
-- The geofence asks "are you at the right place" and nothing ever asked "is
-- this the right day". On Saturday 3 Oct 2026 Ben was on a shift at Swansea
-- Bus Station with Sunday's shift at the same address on his list beneath it.
-- He tapped Sunday's at 14:32 on the Saturday, the fence agreed he was there,
-- and the row sat open overnight until his phone, opened elsewhere on Sunday
-- morning, closed it as "left the geofence": a 19½-hour shift on record, a
-- job marked completed, and no way left to clock in for the real one because
-- the unique index already had his row. The office put it right by hand.
--
-- The cleaner app now disables the button until the hour before and says
-- which day the shift is on. This is the same rule where it cannot be
-- skipped: an older build still installed on somebody's phone, or a check-in
-- queued with no signal and replayed later (lib/clockQueue.js), both go
-- straight to an insert. Mirrored by EARLY_CHECKIN_MINUTES in lib/clockIn.js -
-- change one, change both.
--
-- Only rows a cleaner clocks themselves. self_declared rows are the office's
-- record of a shift (0076, 0078, 0094, 0096) and are written at the booked
-- start by design.
--
-- Both the time written down and the time it arrived are checked. A queued
-- check-in keeps the time they tapped, so checked_in_at is the honest
-- question; now() covers a client that sends a checked_in_at of its own
-- choosing. A replay can only ever arrive later than the tap, so it is never
-- refused here for being early when the tap itself was not.

create or replace function checkins_not_too_early() returns trigger as $$
declare
  starts timestamptz;
begin
  if new.self_declared then return new; end if;

  select scheduled_at into starts from jobs where id = new.job_id;
  if starts is null then return new; end if;

  if coalesce(new.checked_in_at, now()) < starts - interval '60 minutes'
     or now() < starts - interval '60 minutes' then
    -- The cleaner app matches on this text to say which day the shift is on.
    raise exception 'too_early_to_check_in'
      using detail = 'This shift starts at ' || to_char(starts at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                     || '. Check-in opens an hour before.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- A trigger function, never called directly. Revoked per
-- definer-functions-are-public-by-default (0106).
revoke execute on function checkins_not_too_early() from public, anon, authenticated;

drop trigger if exists checkins_not_too_early on checkins;
create trigger checkins_not_too_early
  before insert on checkins
  for each row execute function checkins_not_too_early();
