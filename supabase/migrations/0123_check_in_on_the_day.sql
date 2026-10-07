-- Check-in opens on the shift's day, not an hour before its start.
--
-- 0120 refused any clock-in more than an hour before the booked start. That
-- stopped Ben's Saturday tap on Sunday's shift, but it also turned away
-- cleaners standing at the property on the right day who had simply arrived
-- earlier than that (raised 7 Oct 2026). Being at the property is what
-- decides a check-in - the geofence - so the time now only refuses the wrong
-- day: a clock-in dated before the shift's own day in Europe/London.
--
-- Everything else about 0120 is unchanged: office-recorded (self_declared)
-- rows are exempt, both the tapped time and the arrival time are checked,
-- and the error text is the one the cleaner app matches on. Mirrored by
-- checkInOpensAt in lib/clockIn.js - change one, change both.

create or replace function checkins_not_too_early() returns trigger as $$
declare
  starts timestamptz;
  opens timestamptz;
begin
  if new.self_declared then return new; end if;

  select scheduled_at into starts from jobs where id = new.job_id;
  if starts is null then return new; end if;

  -- Midnight at the start of the shift's day, UK time.
  opens := date_trunc('day', starts at time zone 'Europe/London') at time zone 'Europe/London';

  if coalesce(new.checked_in_at, now()) < opens or now() < opens then
    -- The cleaner app matches on this text to say which day the shift is on.
    raise exception 'too_early_to_check_in'
      using detail = 'This shift starts at ' || to_char(starts at time zone 'Europe/London', 'Dy DD Mon HH24:MI')
                     || '. Check-in opens on the day.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- create or replace keeps 0120's revoke, but say it again so this file is
-- safe to read on its own (definer-functions-are-public-by-default, 0106).
revoke execute on function checkins_not_too_early() from public, anon, authenticated;
