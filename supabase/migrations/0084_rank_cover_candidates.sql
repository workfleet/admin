-- Who should cover this shift? The facts, per cleaner, in one query.
--
-- 0070 offers a released shift to everyone and the first to accept takes it.
-- That fills shifts, but blindly: the push goes to people on approved leave
-- and people already double-booked, the admin's "Assign" list is an
-- alphabetical dropdown, and the cleaner who has done this site every week
-- for a year gets exactly the same nudge as one who has never been.
--
-- This function returns what the app needs to do better, as facts rather
-- than a verdict: has the cleaner worked this property, how far it is from
-- where they already are that day, how many hours they have on that week,
-- how their recent shifts went, whether they have already said no. The
-- weighting into a ranking is done in lib/coverRanking.js, where it can be
-- tested and argued with; the database only says what is true.
--
-- Eligibility is decided here with the same rules claim_shift_offer() (0070)
-- applies at accept time, so nobody is ranked first and then refused.
--
-- Who may call it: admins and supervisors see every cleaner; the server's
-- service role (the push fan-out in api/notify) likewise; a cleaner sees
-- only their own row, which is what lets their offer card say "you've
-- worked here before" without showing them anyone else's record.

-- Great-circle distance, for ranking only. Accurate to well under a percent
-- at the scale of a city, which is all a "how far away is this" needs.
create or replace function distance_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 6371.0 * acos(least(1.0, greatest(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2 - lng1))
      + sin(radians(lat1)) * sin(radians(lat2)))))
  end;
$$ language sql immutable;

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
    where p.role = 'cleaner' and p.active
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

grant execute on function rank_cover_candidates(uuid) to authenticated, service_role;
