-- Payroll close: a pay period the office has looked at, locked, and sent.
--
-- Hours reach QuickBooks by hand: an admin opens Data Reports, picks "Last
-- Week", downloads the hours-per-cleaner CSV and keys it in. The figure in
-- that CSV is live. It changes after the fact, silently, whenever a missed
-- clock-in claim is approved (0076), a short shift is confirmed or corrected
-- (0079), an open shift is closed at its booked end (0080), or a job is edited
-- on the rota. Nothing records what was actually sent, nothing stops the
-- export running with a claim still pending, and nothing distinguishes a
-- week that is settled from one that is still moving.
--
-- So a period can now be closed. Closing refuses while anything in the
-- period is still undecided, takes a per-cleaner, per-job snapshot of the
-- minutes being paid, and locks it. Whatever changes afterwards does not
-- rewrite that snapshot - payroll has already gone out - it lands as a signed
-- adjustment that the next close picks up. The history of what was paid stays
-- exactly as it was paid.
--
-- Dates are London calendar dates, as in 0070: the office runs payroll to a
-- local week, and a Thursday-night shift belongs to Thursday whatever UTC
-- says. Weeks run Friday to Thursday by default, matching the dashboard and
-- Data Reports; that and the weekly/monthly choice live in company_settings.

alter table company_settings
  add column if not exists payroll_frequency text not null default 'weekly'
    check (payroll_frequency in ('weekly', 'monthly')),
  -- 0 = Sunday .. 6 = Saturday, the same numbering as JavaScript's getDay(),
  -- so the client-side period maths in lib/payroll.js reads it unchanged.
  add column if not exists payroll_week_starts_on smallint not null default 5
    check (payroll_week_starts_on between 0 and 6);

-- One row per closed period. period_end is exclusive: a Friday-to-Thursday
-- week is stored as Friday .. the following Friday, so ranges tile with no
-- off-by-one at the join.
create table payroll_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null unique,
  period_end date not null,
  closed_at timestamptz not null default now(),
  closed_by uuid references profiles(id) on delete set null,
  note text,
  check (period_end > period_start)
);

-- The snapshot: what each cleaner was paid for each job when the period
-- closed. Names and addresses are copied in at the time because this is a
-- record of a payment, and it has to still read correctly after the cleaner
-- leaves or the property is deleted - hence set null, never cascade.
create table payroll_period_lines (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references payroll_periods(id) on delete cascade not null,
  cleaner_id uuid references profiles(id) on delete set null,
  cleaner_name text,
  job_id uuid references jobs(id) on delete set null,
  job_address text,
  job_date date not null,
  minutes numeric not null check (minutes >= 0)
);

create index payroll_period_lines_period_id_idx on payroll_period_lines(period_id);
create index payroll_period_lines_cleaner_id_idx on payroll_period_lines(cleaner_id);
create index payroll_period_lines_job_id_idx on payroll_period_lines(job_id);

-- A change to hours already paid. Signed: approving a claim on a closed week
-- is positive, taking someone off a paid job is negative. Written by trigger,
-- never by hand, and carried on the next close (included_in_period_id) so it
-- appears on a pay run rather than vanishing into a corrected total.
create table payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid references profiles(id) on delete set null,
  cleaner_name text,
  job_id uuid references jobs(id) on delete set null,
  job_address text,
  job_date date,
  original_period_id uuid references payroll_periods(id) on delete set null,
  minutes numeric not null,
  reason text not null,
  created_at timestamptz not null default now(),
  included_in_period_id uuid references payroll_periods(id) on delete set null
);

create index payroll_adjustments_cleaner_id_idx on payroll_adjustments(cleaner_id);
create index payroll_adjustments_job_id_idx on payroll_adjustments(job_id);
create index payroll_adjustments_pending_idx on payroll_adjustments(created_at)
  where included_in_period_id is null;

alter table payroll_periods enable row level security;
alter table payroll_period_lines enable row level security;
alter table payroll_adjustments enable row level security;

-- Payroll figures are admin-only, as they have been on the dashboard since
-- 0035 introduced supervisors. Cleaners see their own lines so their hours
-- page can say "this week has gone to payroll" - the one thing that turns a
-- payslip argument into a question asked before the money goes out. The
-- period dates themselves are not sensitive and every member of staff needs
-- them to read those lines.
create policy "payroll_periods: staff select" on payroll_periods
  for select using (is_admin_or_supervisor() or is_active_cleaner());

create policy "payroll_period_lines: admin or own" on payroll_period_lines
  for select using (is_admin() or cleaner_id = auth.uid());

create policy "payroll_adjustments: admin or own" on payroll_adjustments
  for select using (is_admin() or cleaner_id = auth.uid());

-- No insert/update/delete policies on any of the three. Every write goes
-- through the definer functions below, so a period cannot be edited into a
-- different shape after the fact - the point of it is that it cannot.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function payroll_local_date(ts timestamptz) returns date as $$
  select (ts at time zone 'Europe/London')::date;
$$ language sql stable;

-- "6h 30m", the way lib/hoursWorked.js formats it, for notification text.
create or replace function payroll_format_minutes(total numeric) returns text as $$
declare
  whole int := round(abs(total));
  h int := whole / 60;
  m int := whole % 60;
  sign text := case when total < 0 then '-' else '' end;
begin
  if whole = 0 then return '0h'; end if;
  if h = 0 then return sign || m || 'm'; end if;
  if m = 0 then return sign || h || 'h'; end if;
  return sign || h || 'h ' || m || 'm';
end;
$$ language plpgsql immutable;

-- What has already gone out for this cleaner on this job: the snapshot line
-- plus every adjustment since. The trigger below compares against this, so
-- a job corrected three times produces three deltas that sum to the truth
-- rather than three copies of the truth.
create or replace function payroll_paid_minutes(target_cleaner_id uuid, target_job_id uuid)
returns numeric as $$
  select coalesce((select sum(minutes) from payroll_period_lines
                   where cleaner_id = target_cleaner_id and job_id = target_job_id), 0)
       + coalesce((select sum(minutes) from payroll_adjustments
                   where cleaner_id = target_cleaner_id and job_id = target_job_id), 0);
$$ language sql stable;

-- The lines a close of [p_start, p_end) would write, before it writes them.
-- Same rule as lib/hoursWorked.js: completed jobs only, booked minutes split
-- evenly across everyone assigned. A job that already has a line under some
-- earlier period is skipped - it was paid then, and anything that has changed
-- about it since is tracked as an adjustment, so paying it again here would
-- pay it twice.
create or replace function payroll_period_lines_for(p_start date, p_end date)
returns table (
  cleaner_id uuid,
  cleaner_name text,
  job_id uuid,
  job_address text,
  job_date date,
  minutes numeric
) as $$
begin
  if not is_admin() then return; end if;

  return query
    select
      a.cleaner_id,
      pr.full_name,
      j.id,
      p.address,
      payroll_local_date(j.scheduled_at),
      coalesce(j.duration_minutes, 0)::numeric
        / greatest((select count(*) from job_assignments x where x.job_id = j.id), 1)
    from jobs j
    join job_assignments a on a.job_id = j.id
    left join profiles pr on pr.id = a.cleaner_id
    left join properties p on p.id = j.property_id
    where j.status = 'completed'
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end
      and not exists (select 1 from payroll_period_lines l where l.job_id = j.id)
    order by pr.full_name, j.scheduled_at;
end;
$$ language plpgsql stable security definer set search_path = public;

grant execute on function payroll_period_lines_for(date, date) to authenticated;

-- Everything standing between this period and a close, and a few things
-- worth a look that do not block it. `blocking` says which.
--
-- Blocking: a decision is pending that will change the hours, or a job in
-- the period is not in a final state. Each of those is a number that is
-- about to move, and the whole point of closing is to pay a number that has
-- stopped moving.
--
-- Not blocking: a shift nobody clocked into. Those are legitimately unpaid
-- - the cleaner has a claim path (0076) and the admin a confirm button (0078)
-- - but a genuinely missed shift stays missed for ever, so requiring a
-- decision on every one would need a fourth state nobody wants. They are
-- listed so the admin closes with eyes open, not so they are forced to act.
create or replace function payroll_close_review(p_start date, p_end date)
returns table (
  kind text,
  blocking boolean,
  job_id uuid,
  cleaner_id uuid,
  cleaner_name text,
  job_address text,
  scheduled_at timestamptz,
  detail text
) as $$
begin
  if not is_admin() then return; end if;

  return query
    -- A claim waiting on the office.
    select 'pending_claim'::text, true, c.job_id, c.cleaner_id, pr.full_name, p.address, j.scheduled_at,
           'Missed clock-in claim waiting for a decision'::text
    from missed_clockin_claims c
    join jobs j on j.id = c.job_id
    left join properties p on p.id = j.property_id
    left join profiles pr on pr.id = c.cleaner_id
    where c.status = 'pending'
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end

    union all

    -- A shift the clock disagreed with (0079).
    select 'short_shift'::text, true, j.id, null::uuid, null::text, p.address, j.scheduled_at,
           'Clocked well under the booked time - confirm or correct the hours'::text
    from jobs j
    left join properties p on p.id = j.property_id
    where j.hours_review_needed
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end

    union all

    -- Not finished. After reconcile_job_statuses() this is a job still
    -- running past the period's end, or one whose booked end is later than
    -- now - either way its hours are not settled yet.
    select 'unfinished'::text, true, j.id, null::uuid, null::text, p.address, j.scheduled_at,
           case when j.status = 'in_progress'
                then 'Still in progress - nobody has checked out yet'
                else 'Not started and not yet marked missed' end
    from jobs j
    left join properties p on p.id = j.property_id
    where j.status in ('scheduled', 'in_progress')
      and not j.hours_review_needed
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end

    union all

    -- Nobody clocked in, nobody has said they worked it. Listed, not held.
    select 'missed_shift'::text, false, j.id, a.cleaner_id, pr.full_name, p.address, j.scheduled_at,
           'Nobody clocked in - unpaid unless someone confirms it was worked'::text
    from jobs j
    join job_assignments a on a.job_id = j.id
    left join profiles pr on pr.id = a.cleaner_id
    left join properties p on p.id = j.property_id
    where j.status = 'missed'
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end

    order by 7;
end;
$$ language plpgsql stable security definer set search_path = public;

grant execute on function payroll_close_review(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Closing
-- ---------------------------------------------------------------------------

-- Status codes rather than exceptions, as everywhere else that writes on an
-- admin's behalf, so the page can say which rule refused rather than "error".
create or replace function close_payroll_period(p_start date, p_end date, p_note text default null)
returns text as $$
declare
  last_end date;
  new_id uuid;
  rec record;
begin
  if not is_admin() then return 'not_allowed'; end if;
  if p_start is null or p_end is null or p_end <= p_start then return 'bad_range'; end if;

  -- A period closes once it is over, not before: a Thursday-night shift
  -- checked out at 23:50 still belongs to the week being closed.
  if p_end > payroll_local_date(now()) then return 'period_not_ended'; end if;

  -- Periods tile. The first close can start anywhere - everything before it
  -- was paid outside the app - but after that each period begins where the
  -- last ended, so there is never a week that nobody closed and nobody
  -- noticed.
  select max(period_end) into last_end from payroll_periods;
  if last_end is not null and p_start <> last_end then return 'not_next'; end if;
  if exists (select 1 from payroll_periods where period_start < p_end and period_end > p_start) then
    return 'overlaps';
  end if;

  -- The lazy sweep the dashboard and rota run on load, run here on purpose:
  -- an overdue job still saying 'scheduled' is a blocker only because nobody
  -- has opened a page since it ended, and the admin should not have to.
  perform reconcile_job_statuses();

  if exists (select 1 from payroll_close_review(p_start, p_end) where blocking) then
    return 'blocked';
  end if;

  insert into payroll_periods (period_start, period_end, closed_by, note)
  values (p_start, p_end, auth.uid(), nullif(trim(p_note), ''))
  returning id into new_id;

  insert into payroll_period_lines (period_id, cleaner_id, cleaner_name, job_id, job_address, job_date, minutes)
  select new_id, l.cleaner_id, l.cleaner_name, l.job_id, l.job_address, l.job_date, l.minutes
  from payroll_period_lines_for(p_start, p_end) l;

  -- Every correction that has been waiting since the last run goes out on
  -- this one, whichever period it originally belonged to.
  update payroll_adjustments
  set included_in_period_id = new_id
  where included_in_period_id is null;

  -- Tell each person what went out under their name. This is the moment a
  -- wrong figure is cheapest to query.
  for rec in
    select t.cleaner_id, sum(t.minutes) as minutes
    from (
      select l.cleaner_id, l.minutes from payroll_period_lines l where l.period_id = new_id
      union all
      select a.cleaner_id, a.minutes from payroll_adjustments a where a.included_in_period_id = new_id
    ) t
    where t.cleaner_id is not null
    group by t.cleaner_id
  loop
    insert into notifications (user_id, message)
    values (rec.cleaner_id,
      'Your hours for ' || to_char(p_start, 'DD Mon') || ' to ' || to_char(p_end - 1, 'DD Mon')
      || ' have gone to payroll: ' || payroll_format_minutes(rec.minutes)
      || '. Message the office if that is not right.');
  end loop;

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function close_payroll_period(date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Adjustments: what happens to a paid job when it changes
-- ---------------------------------------------------------------------------

-- Recomputes what each cleaner is now owed for one job and writes the
-- difference from what they have been paid. Only jobs payroll has a stake in:
-- one that already has a line or adjustment, or one dated inside a closed
-- period (a job created or moved into a closed week has been paid nothing,
-- and this is what pays it).
--
-- A job in an open period with no lines is left alone. Its close will pick
-- it up, and until then every edit is just an edit.
create or replace function payroll_record_job_change(target_job_id uuid, deleting boolean, reason text)
returns void as $$
declare
  job_row jobs;
  d date;
  period uuid;
  assignee_count int;
  owed numeric;
  paid numeric;
  addr text;
  cname text;
  rec record;
begin
  select * into job_row from jobs where id = target_job_id;
  if not found then return; end if;

  d := payroll_local_date(job_row.scheduled_at);
  select id into period from payroll_periods where d >= period_start and d < period_end;

  if period is null
     and not exists (select 1 from payroll_period_lines where job_id = target_job_id)
     and not exists (select 1 from payroll_adjustments where job_id = target_job_id) then
    return;
  end if;

  -- For the record's sake: a job moved out of the week it was paid in still
  -- names that week as where the money originally went.
  if period is null then
    select period_id into period from payroll_period_lines where job_id = target_job_id limit 1;
  end if;

  select count(*) into assignee_count from job_assignments where job_id = target_job_id;
  select p.address into addr from properties p where p.id = job_row.property_id;

  -- Everyone with a stake: currently assigned, or paid for it in the past.
  for rec in
    select a.cleaner_id from job_assignments a where a.job_id = target_job_id
    union
    select l.cleaner_id from payroll_period_lines l where l.job_id = target_job_id and l.cleaner_id is not null
    union
    select x.cleaner_id from payroll_adjustments x where x.job_id = target_job_id and x.cleaner_id is not null
  loop
    if deleting
       or job_row.status <> 'completed'
       or not exists (select 1 from job_assignments a where a.job_id = target_job_id and a.cleaner_id = rec.cleaner_id) then
      owed := 0;
    else
      owed := coalesce(job_row.duration_minutes, 0)::numeric / greatest(assignee_count, 1);
    end if;

    paid := payroll_paid_minutes(rec.cleaner_id, target_job_id);

    if owed <> paid then
      select full_name into cname from profiles where id = rec.cleaner_id;
      insert into payroll_adjustments
        (cleaner_id, cleaner_name, job_id, job_address, job_date, original_period_id, minutes, reason)
      values
        (rec.cleaner_id, cname, target_job_id, addr, d, period, owed - paid, reason);
    end if;
  end loop;
end;
$$ language plpgsql security definer set search_path = public;

-- Every route that changes a job's hours ends in one of these three columns
-- changing: a claim approval or short-shift confirmation flips status, a
-- correction rewrites duration_minutes, a rota edit moves scheduled_at. The
-- trigger keys off the columns rather than the routes so a new route cannot
-- forget to tell payroll.
create or replace function payroll_jobs_changed() returns trigger as $$
declare
  reason text;
begin
  if tg_op = 'DELETE' then
    perform payroll_record_job_change(old.id, true, 'Job deleted after payroll closed');
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform payroll_record_job_change(new.id, false, 'Job added after payroll closed');
    return new;
  end if;

  if new.status is distinct from old.status then
    reason := case when new.status = 'completed'
      then 'Shift confirmed as worked after payroll closed'
      else 'Shift no longer counts as completed' end;
  elsif new.duration_minutes is distinct from old.duration_minutes then
    reason := 'Booked length changed from ' || coalesce(old.duration_minutes::text, '?')
      || ' to ' || coalesce(new.duration_minutes::text, '?') || ' min after payroll closed';
  elsif new.scheduled_at is distinct from old.scheduled_at then
    reason := 'Shift moved to ' || to_char(new.scheduled_at at time zone 'Europe/London', 'DD Mon')
      || ' after payroll closed';
  else
    reason := 'Hours changed after payroll closed';
  end if;

  perform payroll_record_job_change(new.id, false, reason);
  return new;
end;
$$ language plpgsql security definer;

create trigger payroll_jobs_changed_after
  after insert or update of status, duration_minutes, scheduled_at on jobs
  for each row execute procedure payroll_jobs_changed();

-- Before, not after: the job row has to still be there to read its date and
-- duration. The adjustment's job_id is nulled by the foreign key a moment
-- later, which is why the address and date are copied onto it.
create trigger payroll_jobs_changed_before_delete
  before delete on jobs
  for each row execute procedure payroll_jobs_changed();

-- Who is on the job changes each person's share as well as who gets one.
-- When a job is deleted these fire during the cascade, find no job row, and
-- do nothing - the before-delete trigger above has already settled it.
create or replace function payroll_assignments_changed() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform payroll_record_job_change(old.job_id, false, 'Taken off the job after payroll closed');
    return old;
  end if;

  perform payroll_record_job_change(new.job_id, false,
    case when tg_op = 'INSERT' then 'Added to the job after payroll closed'
         else 'Job assignment changed after payroll closed' end);

  if tg_op = 'UPDATE' and new.job_id is distinct from old.job_id then
    perform payroll_record_job_change(old.job_id, false, 'Taken off the job after payroll closed');
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger payroll_assignments_changed_after
  after insert or update or delete on job_assignments
  for each row execute procedure payroll_assignments_changed();
