-- Not everybody who is a cleaner is in the market for other people's shifts.
--
-- Cover goes out to every active cleaner: pushed to their phone (api/notify),
-- listed in the app as a marketplace anyone can claim (0070), and ranked for
-- the office as a suggestion (0084). That was a fair description of the staff
-- list when it was written. It stopped being one when the person who does the
-- stock take became a cleaner (0118) - he turns up to a booked hour counting
-- stock, and a push offering him somebody's Tuesday clean in Mumbles is noise
-- at best and a shift covered by the wrong person at worst.
--
-- So who takes cover becomes its own answer, defaulting to yes: every cleaner
-- on the books today is exactly as available as they were yesterday, and this
-- only gives the office a way to say otherwise.
--
-- Releasing is deliberately NOT affected. Someone who does not take other
-- people's shifts can still put their own out for cover when they are off,
-- and still sees that offer in their own history - the select policy below
-- keeps their released and filled rows visible whatever this says.

alter table profiles
  add column if not exists takes_cover boolean not null default true;

comment on column profiles.takes_cover is
  'Should this person be offered shifts that need covering. Default yes; off for staff whose work is not cleaning visits.';

-- A definer helper rather than a subquery in the policy, matching
-- is_active_cleaner() (0009): the policy is evaluated per row, and a helper
-- that runs as owner cannot be tangled up in another table's RLS.
create or replace function caller_takes_cover() returns boolean as $$
  select coalesce((select takes_cover from profiles where id = auth.uid()), false)
$$ language sql security definer stable set search_path = public;

revoke execute on function caller_takes_cover() from public;
grant execute on function caller_takes_cover() to anon, authenticated;

-- The marketplace, minus anyone who is not in it. Their own released and
-- filled offers stay visible regardless, which is what keeps a released
-- shift in their history after it closes.
drop policy if exists "shift_offers: cleaner select" on shift_offers;
create policy "shift_offers: cleaner select" on shift_offers
  for select using (
    is_active_cleaner()
    and (
      (status = 'open' and caller_takes_cover())
      or released_by = auth.uid()
      or filled_by = auth.uid()
    )
  );

-- Claiming is the half that matters: not seeing an offer is a UI state, not
-- being allowed to take it is the rule. Lifted from 0070 unchanged except for
-- the eligibility line.
create or replace function claim_shift_offer(target_offer_id uuid) returns text as $$
declare
  offer record;
  job record;
  caller_role text;
  job_date date;
begin
  select * into offer from shift_offers where id = target_offer_id for update;
  if not found then return 'not_found'; end if;
  if offer.status <> 'open' then return 'already_taken'; end if;
  if offer.expires_at is not null and offer.expires_at <= now() then return 'expired'; end if;

  select role into caller_role from profiles where id = auth.uid();
  -- 0119: and not somebody whose work is not other people's shifts.
  if caller_role <> 'cleaner' or not is_active_cleaner() or not caller_takes_cover() then
    return 'not_eligible';
  end if;

  select * into job from jobs where id = offer.job_id;
  if not found then return 'not_found'; end if;
  if job.scheduled_at <= now() or job.status <> 'scheduled' then return 'too_late'; end if;

  if exists (select 1 from job_assignments where job_id = offer.job_id and cleaner_id = auth.uid()) then
    return 'already_on_job';
  end if;

  -- Time off is stored as plain dates, so the shift's timestamp has to
  -- be read in UK local time to land on the right day - in BST a 00:30
  -- UTC shift belongs to the following date.
  job_date := (job.scheduled_at at time zone 'Europe/London')::date;

  if exists (
    select 1 from time_off_requests t
    where t.cleaner_id = auth.uid()
      and t.status = 'approved'
      and job_date between t.start_date and t.end_date
  ) then
    return 'on_time_off';
  end if;

  -- duration_minutes has no default in every environment, so fall back
  -- to an hour rather than letting a null collapse the range to a point
  -- and wave through a genuine double-booking.
  if exists (
    select 1 from job_assignments ja
    join jobs other on other.id = ja.job_id
    where ja.cleaner_id = auth.uid()
      and other.id <> job.id
      and other.status in ('scheduled', 'in_progress')
      and tstzrange(other.scheduled_at,
                    other.scheduled_at + make_interval(mins => coalesce(other.duration_minutes, 60)))
          && tstzrange(job.scheduled_at,
                       job.scheduled_at + make_interval(mins => coalesce(job.duration_minutes, 60)))
  ) then
    return 'clashes';
  end if;

  if offer.released_by is not null then
    delete from job_assignments where job_id = offer.job_id and cleaner_id = offer.released_by;
  end if;

  -- Fires notify_on_job_assignment() from 0030, so the claimer gets the
  -- same "new shift assigned" notification as any other assignment.
  insert into job_assignments (job_id, cleaner_id)
  values (offer.job_id, auth.uid())
  on conflict (job_id, cleaner_id) do nothing;

  update shift_offers
  set status = 'filled', filled_by = auth.uid(), filled_at = now()
  where id = target_offer_id;

  insert into shift_offer_responses (offer_id, cleaner_id, response)
  values (target_offer_id, auth.uid(), 'accepted')
  on conflict (offer_id, cleaner_id) do update set response = 'accepted', created_at = now();

  if offer.released_by is not null then
    insert into notifications (user_id, message)
    values (
      offer.released_by,
      'Your shift on ' || to_char(job.scheduled_at, 'DD Mon at HH24:MI') || ' has been covered.'
    );
  end if;

  insert into notifications (user_id, message)
  select p.id,
    'Cover found: ' || coalesce(claimer.full_name, 'A cleaner')
    || ' has taken the shift on ' || to_char(job.scheduled_at, 'DD Mon at HH24:MI') || '.'
  from profiles p
  cross join (select full_name from profiles where id = auth.uid()) claimer
  where p.role in ('admin', 'supervisor');

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

-- Suggestions to the office, lifted from 0084 unchanged except for the one
-- line that says who is a candidate. The office can still assign anyone by
-- hand from the Cover page - this only stops the app proposing someone whose
-- job is not covering shifts.
create or replace function rank_cover_candidates(target_offer_id uuid)
returns table (
  cleaner_id uuid,
  full_name text,
  eligible boolean,
  ineligible_reason text,
  visits_here integer,
  last_visit_at timestamptz,
  hours_this_week numeric,
  distance_km numeric,
  distance_basis text,
  completed_recent integer,
  missed_recent integer,
  rated_count integer,
  avg_rating numeric,
  declined boolean
) as $$
declare
  offer shift_offers;
  job jobs;
  prop properties;
  job_date date;
  week_start date;
  week_end date;
  starts_on integer;
  only_self boolean;
  job_range tstzrange;
begin
  if auth.role() = 'service_role' or is_admin_or_supervisor() then
    only_self := false;
  elsif is_active_cleaner() then
    only_self := true;
  else
    return;
  end if;

  select * into offer from shift_offers where id = target_offer_id;
  if not found then return; end if;
  select * into job from jobs where id = offer.job_id;
  if not found then return; end if;
  select * into prop from properties where id = job.property_id;

  job_date := payroll_local_date(job.scheduled_at);
  job_range := tstzrange(job.scheduled_at, job.scheduled_at + make_interval(mins => coalesce(job.duration_minutes, 60)));

  -- The same week payroll counts, so "hours this week" means what the
  -- office means by it.
  select coalesce(payroll_week_starts_on, 5) into starts_on from company_settings limit 1;
  starts_on := coalesce(starts_on, 5);
  week_start := job_date - ((extract(dow from job_date)::integer - starts_on + 7) % 7);
  week_end := week_start + 7;

  return query
  with candidates as (
    select p.id, p.full_name
    from profiles p
    where p.role = 'cleaner' and p.active and p.takes_cover
      and (not only_self or p.id = auth.uid())
  ),
  visits as (
    select ja.cleaner_id, count(*)::integer as n, max(j.scheduled_at) as last_at
    from job_assignments ja
    join jobs j on j.id = ja.job_id
    where j.property_id = job.property_id and j.status = 'completed' and j.id <> job.id
    group by ja.cleaner_id
  ),
  week_hours as (
    select ja.cleaner_id,
      sum(coalesce(j.duration_minutes, 0)::numeric
          / greatest((select count(*) from job_assignments x where x.job_id = j.id), 1)) / 60 as hours
    from job_assignments ja
    join jobs j on j.id = ja.job_id
    where j.id <> job.id
      and j.status in ('scheduled', 'in_progress', 'completed')
      and payroll_local_date(j.scheduled_at) >= week_start
      and payroll_local_date(j.scheduled_at) < week_end
    group by ja.cleaner_id
  ),
  -- Nearest other job that day, if the cleaner has one with coordinates.
  same_day as (
    select ja.cleaner_id, min(distance_km(prop.lat, prop.lng, pr.lat, pr.lng)) as km
    from job_assignments ja
    join jobs j on j.id = ja.job_id
    join properties pr on pr.id = j.property_id
    where j.id <> job.id
      and j.status in ('scheduled', 'in_progress')
      and payroll_local_date(j.scheduled_at) = job_date
      and pr.lat is not null and pr.lng is not null
    group by ja.cleaner_id
  ),
  -- Otherwise the middle of where they have worked lately. Rough, and
  -- labelled as such in the app.
  usual_area as (
    select ja.cleaner_id, avg(pr.lat) as lat, avg(pr.lng) as lng
    from job_assignments ja
    join jobs j on j.id = ja.job_id
    join properties pr on pr.id = j.property_id
    where j.status = 'completed'
      and j.scheduled_at > now() - interval '60 days'
      and pr.lat is not null and pr.lng is not null
    group by ja.cleaner_id
  ),
  history as (
    select ja.cleaner_id,
      count(*) filter (where j.status = 'completed')::integer as done,
      count(*) filter (where j.status = 'missed')::integer as missed
    from job_assignments ja
    join jobs j on j.id = ja.job_id
    where j.scheduled_at > now() - interval '90 days' and j.scheduled_at < now()
    group by ja.cleaner_id
  ),
  ratings as (
    select ja.cleaner_id, count(*)::integer as n, avg(r.rating)::numeric as avg_rating
    from job_ratings r
    join job_assignments ja on ja.job_id = r.job_id
    group by ja.cleaner_id
  ),
  clashing as (
    select distinct ja.cleaner_id
    from job_assignments ja
    join jobs o on o.id = ja.job_id
    where o.id <> job.id
      and o.status in ('scheduled', 'in_progress')
      and tstzrange(o.scheduled_at, o.scheduled_at + make_interval(mins => coalesce(o.duration_minutes, 60))) && job_range
  ),
  away as (
    select distinct t.cleaner_id
    from time_off_requests t
    where t.status = 'approved' and job_date between t.start_date and t.end_date
  ),
  on_job as (
    select ja.cleaner_id from job_assignments ja where ja.job_id = job.id
  ),
  declines as (
    select r.cleaner_id from shift_offer_responses r
    where r.offer_id = target_offer_id and r.response = 'declined'
  )
  select
    c.id,
    c.full_name,
    case
      when c.id = offer.released_by then false
      when exists (select 1 from on_job o where o.cleaner_id = c.id) then false
      when exists (select 1 from away a where a.cleaner_id = c.id) then false
      when exists (select 1 from clashing x where x.cleaner_id = c.id) then false
      else true
    end,
    case
      when c.id = offer.released_by then 'released this shift'
      when exists (select 1 from on_job o where o.cleaner_id = c.id) then 'already on this job'
      when exists (select 1 from away a where a.cleaner_id = c.id) then 'on approved time off'
      when exists (select 1 from clashing x where x.cleaner_id = c.id) then 'on another shift at that time'
      else null
    end,
    coalesce(v.n, 0),
    v.last_at,
    coalesce(wh.hours, 0),
    case
      when prop.lat is null or prop.lng is null then null
      when sd.km is not null then round(sd.km::numeric, 1)
      when ua.lat is not null then round(distance_km(prop.lat, prop.lng, ua.lat, ua.lng)::numeric, 1)
      else null
    end,
    case
      when prop.lat is null or prop.lng is null then null
      when sd.km is not null then 'same_day_job'
      when ua.lat is not null then 'usual_area'
      else null
    end,
    coalesce(h.done, 0),
    coalesce(h.missed, 0),
    coalesce(r.n, 0),
    round(r.avg_rating, 1),
    exists (select 1 from declines d where d.cleaner_id = c.id)
  from candidates c
  left join visits v on v.cleaner_id = c.id
  left join week_hours wh on wh.cleaner_id = c.id
  left join same_day sd on sd.cleaner_id = c.id
  left join usual_area ua on ua.cleaner_id = c.id
  left join history h on h.cleaner_id = c.id
  left join ratings r on r.cleaner_id = c.id
  order by c.full_name;
end;
$$ language plpgsql stable security definer set search_path = public;

-- Third thing on this row an admin owns, alongside role, active and
-- manages_inventory (0118). "profiles: self update" (0091) would otherwise
-- let a cleaner quietly opt themselves out of cover.
create or replace function prevent_self_privilege_escalation() returns trigger as $$
begin
  if auth.uid() is not null and not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change role';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only an admin can change active status';
    end if;
    if new.manages_inventory is distinct from old.manages_inventory then
      raise exception 'Only an admin can change who manages stock';
    end if;
    if new.takes_cover is distinct from old.takes_cover then
      raise exception 'Only an admin can change who is offered cover';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
