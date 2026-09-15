-- Optional repair for the four shifts 0080's sweep closed mid-shift because
-- the cleaner had clocked in late (see 0098 for the fix going forward).
--
-- Rewrites each check-out to clock-in plus the booked duration, which is the
-- time 0098 would have written. It is still a guess - nobody clocked out - so
-- the closed_at_booked_end flag stays and the record still reads "never
-- clocked out". Pay is untouched: all four jobs are completed and confirmed,
-- and pay follows the booked minutes, not the clock.
--
-- Run in the Supabase SQL editor. Affects exactly these rows:
--   Jennie Morgan  15 Sep 18:18 -> 19:00, Dillwyn Road       (becomes 20:18)
--   Jennie Morgan  15 Sep 08:36 -> 10:00, Swansea Road       (becomes 10:36)
--   Jennie Morgan  14 Sep 18:19 -> 19:00, Dillwyn Road       (becomes 20:19)
--   Joanne Casey    9 Sep 12:21 -> 16:00, Beechtree Lane     (becomes 20:21)
update checkins c
set checked_out_at = c.checked_in_at + (j.duration_minutes || ' minutes')::interval
from jobs j
where j.id = c.job_id
  and c.closed_at_booked_end
  and c.checked_in_at >= '2026-09-01'
  and c.checked_out_at = j.scheduled_at + (j.duration_minutes || ' minutes')::interval
  and c.checked_in_at > j.scheduled_at
  and c.checked_in_at + (j.duration_minutes || ' minutes')::interval > c.checked_out_at;
