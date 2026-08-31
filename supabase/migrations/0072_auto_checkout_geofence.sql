-- Auto check-out when a cleaner leaves the property's geofence.
--
-- checked_out_at can now be written by the app on a cleaner's behalf
-- rather than only by them pressing Check Out, so the row has to record
-- which of the two it was. This is an attendance record staff can be
-- pulled up on - the onboarding agreement has a clause about falsified
-- clock-in records - so "they pressed the button" and "we inferred it
-- from their phone" must never look identical to whoever reads it back.
alter table checkins
  add column if not exists auto_checked_out boolean not null default false;

-- The last moment the app could positively place this cleaner inside the
-- geofence. Written while the job page is open and a location watch is
-- running, and used as the check-out time when a departure is actually
-- observed. Null on check-ins predating this feature, and on any where
-- location was never available - both fall back to the scheduled end.
alter table checkins
  add column if not exists last_seen_inside_at timestamptz;

-- No RLS change needed: "checkins: cleaner own" is already `for all`,
-- which covers a cleaner updating their own row, and both new columns
-- sit inside rows that policy already governs.
