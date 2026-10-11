-- Shifts needing cover were invisible to the people meant to cover them.
--
-- The cleaner home page lists open offers (0070) by reading shift_offers and
-- embedding the job and its address. A cleaner can read the offer row, but
-- jobs and properties only show a cleaner the jobs they are already on
-- (0030), so for anybody else's shift the embed came back null and the card
-- dropped the offer as "deleted". Only the person who released a shift ever
-- saw it; an offer the office opened was seen by nobody. 0070 wrote
-- open_offer_job_ids() / open_offer_property_ids() for exactly this but never
-- put them in a policy, and 0106 revoked them as unused.
--
-- Rather than open whole job and property rows to every cleaner - the
-- property row carries access_details, which nobody should read for a shift
-- they have not taken - this hands back just what the card shows: when, how
-- long and where. Claiming still goes through claim_shift_offer(), which
-- makes every eligibility check itself.

create or replace function open_cover_shifts()
returns table (
  id uuid,
  job_id uuid,
  reason text,
  released_by uuid,
  expires_at timestamptz,
  created_at timestamptz,
  scheduled_at timestamptz,
  duration_minutes integer,
  address text,
  releaser_name text
) as $$
  select so.id, so.job_id, so.reason, so.released_by, so.expires_at, so.created_at,
    j.scheduled_at, j.duration_minutes, p.address, rp.full_name
  from shift_offers so
  join jobs j on j.id = so.job_id
  left join properties p on p.id = j.property_id
  left join profiles rp on rp.id = so.released_by
  where is_active_cleaner()
    and so.status = 'open'
    and (so.expires_at is null or so.expires_at > now())
    and j.status = 'scheduled'
    and j.scheduled_at > now()
    -- Same rule as the "shift_offers: cleaner select" policy (0119): your own
    -- request always, everybody else's only if you take cover.
    and (so.released_by = auth.uid() or caller_takes_cover())
  order by so.created_at desc
$$ language sql stable security definer set search_path = public;

revoke execute on function open_cover_shifts() from public, anon;
grant execute on function open_cover_shifts() to authenticated;
