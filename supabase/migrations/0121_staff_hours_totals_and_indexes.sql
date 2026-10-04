-- Two things the app needs now it holds a few months of real data.
--
-- 1. staff_hours_totals(): each person's hours worked and holiday taken,
--    added up in the database.
--
--    The Cleaners and Requests pages used to fetch every job_assignments
--    row there has ever been and add them up in the browser. PostgREST
--    hands back at most 1000 rows per request and says nothing when it
--    stops, and the table passed 870 rows in October 2026 with recurring
--    series booked out to 2028 - so those pages were weeks from summing an
--    arbitrary 1000 of them and showing everyone the wrong holiday balance.
--    A sum done here is one row per person, however long the history.
--
--    The share rule is the one in lib/hoursWorked.js and
--    assignment_paid_minutes() (0094): a completed job's minutes split
--    evenly across everyone on it, unless the office set that person's
--    minutes by hand. Written as one set-based query rather than calling
--    assignment_paid_minutes() per row, which would count each job's
--    assignees once per assignee.
--
--    The office (admin or supervisor) gets everyone, matching the
--    profile_private select policy (0088) the balances already read; anyone
--    else gets only their own row. p_cleaner_id narrows it to one person.
--
-- 2. Indexes. schema.sql created the original tables with none at all, so
--    every rota, dashboard and notification query scans the whole table.
--    That was invisible at a few hundred rows and won't stay so.

create or replace function staff_hours_totals(p_cleaner_id uuid default null)
returns table (
  cleaner_id uuid,
  worked_minutes numeric,
  assignment_count bigint,
  holiday_approved_hours numeric,
  holiday_pending_hours numeric
) as $$
  with people as (
    select p.id
    from profiles p
    where p.role <> 'client'
      and (p_cleaner_id is null or p.id = p_cleaner_id)
      and (is_admin_or_supervisor() or p.id = auth.uid())
  ),
  assignee_counts as (
    select x.job_id, count(*) as n
    from job_assignments x
    where x.job_id in (select a.job_id from job_assignments a where a.cleaner_id in (select id from people))
    group by x.job_id
  ),
  worked as (
    select
      a.cleaner_id,
      sum(
        case when j.status = 'completed' then
          coalesce(a.paid_minutes::numeric, coalesce(j.duration_minutes, 0)::numeric / greatest(c.n, 1))
        else 0 end
      ) as minutes,
      count(*) as assignments
    from job_assignments a
    join jobs j on j.id = a.job_id
    join assignee_counts c on c.job_id = a.job_id
    where a.cleaner_id in (select id from people)
    group by a.cleaner_id
  ),
  holiday as (
    select
      t.cleaner_id,
      sum(case when t.status = 'approved' then coalesce(t.hours, 0) else 0 end) as approved,
      sum(case when t.status = 'pending' then coalesce(t.hours, 0) else 0 end) as pending
    from time_off_requests t
    where t.type = 'holiday'
      and t.cleaner_id in (select id from people)
    group by t.cleaner_id
  )
  select
    p.id,
    coalesce(w.minutes, 0),
    coalesce(w.assignments, 0),
    coalesce(h.approved, 0),
    coalesce(h.pending, 0)
  from people p
  left join worked w on w.cleaner_id = p.id
  left join holiday h on h.cleaner_id = p.id
$$ language sql stable security definer set search_path = public;

-- New functions are executable by PUBLIC (and so the anon key) by default;
-- only a revoke changes that. Signed-in users only.
revoke execute on function staff_hours_totals(uuid) from public, anon;
grant execute on function staff_hours_totals(uuid) to authenticated;

-- is_admin() (schema.sql) sits in nearly every RLS policy but was never
-- marked STABLE, so Postgres treats it as volatile and may run it again for
-- every row a policy checks. Same body; now STABLE, with a fixed
-- search_path like the newer helpers.
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable set search_path = public;

-- jobs: scheduled_at is behind the rota, dashboard, cover and every date
-- window in the app.
create index if not exists jobs_scheduled_at_idx on jobs(scheduled_at);
create index if not exists jobs_property_id_idx on jobs(property_id);
create index if not exists jobs_cleaner_id_idx on jobs(cleaner_id);
-- The every-15-minutes clock-in nudge (0112) looks only at these.
create index if not exists jobs_nudge_due_idx on jobs(scheduled_at)
  where status = 'scheduled' and clockin_nudge_sent_at is null;

-- notifications: always read per person, newest first.
create index if not exists notifications_user_id_created_at_idx on notifications(user_id, created_at desc);

-- Child tables of jobs, read by job_id on every job page.
create index if not exists photos_job_id_idx on photos(job_id, created_at);
create index if not exists checkins_job_id_idx on checkins(job_id);
create index if not exists checkins_cleaner_id_idx on checkins(cleaner_id);
create index if not exists tasks_job_id_idx on tasks(job_id);

-- Clients: properties by client, and the client RLS policies that look up
-- profiles.client_id for the signed-in user.
create index if not exists properties_client_id_idx on properties(client_id);
create index if not exists profiles_client_id_idx on profiles(client_id) where client_id is not null;
