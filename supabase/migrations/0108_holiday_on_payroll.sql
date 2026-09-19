-- Approved holiday goes to payroll as holiday hours.
--
-- A holiday request carried its hours (0024) and came off the balance
-- (0026), but never reached a pay run: payroll_period_lines_for only knew
-- about completed jobs, so an approved week off paid nothing unless the
-- office remembered to add it by hand. Now each pay period also carries
-- one line per approved holiday request that touches it, marked as
-- holiday rather than work, so the payroll page, the CSV and the
-- cleaner's My Hours all show holiday hours separately from hours worked.
--
-- A request's hours are spread evenly over the days it covers, so a
-- request that straddles two pay periods pays its share in each.

-- Written to be re-runnable: the first attempt at applying this stopped
-- partway on one project, and if not exists lets it be run again whole.
alter table payroll_period_lines
  add column if not exists kind text not null default 'worked' check (kind in ('worked', 'holiday')),
  add column if not exists time_off_id uuid references time_off_requests(id) on delete set null;

create index if not exists payroll_period_lines_time_off_id_idx on payroll_period_lines(time_off_id);

-- The return shape gains two columns, which create or replace cannot do.
-- 0106 revoked the public key's access to this function and granted it
-- to signed-in users; dropping it drops those grants, so they are set
-- again below.
drop function if exists payroll_period_lines_for(date, date);

create function payroll_period_lines_for(p_start date, p_end date)
returns table (
  cleaner_id uuid,
  cleaner_name text,
  job_id uuid,
  job_address text,
  job_date date,
  minutes numeric,
  kind text,
  time_off_id uuid
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
      coalesce(assignment_paid_minutes(j.id, a.cleaner_id), 0),
      'worked'::text,
      null::uuid
    from jobs j
    join job_assignments a on a.job_id = j.id
    left join profiles pr on pr.id = a.cleaner_id
    left join properties p on p.id = j.property_id
    where j.status = 'completed'
      and payroll_local_date(j.scheduled_at) >= p_start
      and payroll_local_date(j.scheduled_at) < p_end
      and not exists (select 1 from payroll_period_lines l where l.job_id = j.id)

    union all

    -- One line per approved holiday request that overlaps the period, for
    -- the share of its hours that falls inside. Dated from its first day
    -- in the period so it sorts among that week's work.
    select
      r.cleaner_id,
      pr.full_name,
      null::uuid,
      'Holiday'::text,
      greatest(r.start_date, p_start),
      round(
        r.hours * 60
          * (least(r.end_date, p_end - 1) - greatest(r.start_date, p_start) + 1)
          / (r.end_date - r.start_date + 1),
        2),
      'holiday'::text,
      r.id
    from time_off_requests r
    left join profiles pr on pr.id = r.cleaner_id
    where r.type = 'holiday'
      and r.status = 'approved'
      and coalesce(r.hours, 0) > 0
      and r.start_date < p_end
      and r.end_date >= p_start
      and not exists (
        select 1 from payroll_period_lines l
        join payroll_periods pp on pp.id = l.period_id
        where l.time_off_id = r.id and pp.period_start = p_start
      )

    order by 2, 5;
end;
$$ language plpgsql stable security definer set search_path = public;

revoke execute on function payroll_period_lines_for(date, date) from public, anon;
grant execute on function payroll_period_lines_for(date, date) to authenticated;

-- Closing carries the two new columns onto the stored lines, and the
-- message to each cleaner says how much of their figure is holiday.
create or replace function close_payroll_period(p_start date, p_end date, p_note text default null)
returns text as $$
declare
  last_end date;
  new_id uuid;
  rec record;
begin
  if not is_admin() then return 'not_allowed'; end if;
  if p_start is null or p_end is null or p_end <= p_start then return 'bad_range'; end if;

  if p_end > payroll_local_date(now()) then return 'period_not_ended'; end if;

  select max(period_end) into last_end from payroll_periods;
  if last_end is not null and p_start <> last_end then return 'not_next'; end if;
  if exists (select 1 from payroll_periods where period_start < p_end and period_end > p_start) then
    return 'overlaps';
  end if;

  perform reconcile_job_statuses();

  if exists (select 1 from payroll_close_review(p_start, p_end) where blocking) then
    return 'blocked';
  end if;

  insert into payroll_periods (period_start, period_end, closed_by, note)
  values (p_start, p_end, auth.uid(), nullif(trim(p_note), ''))
  returning id into new_id;

  insert into payroll_period_lines (period_id, cleaner_id, cleaner_name, job_id, job_address, job_date, minutes, kind, time_off_id)
  select new_id, l.cleaner_id, l.cleaner_name, l.job_id, l.job_address, l.job_date, l.minutes, l.kind, l.time_off_id
  from payroll_period_lines_for(p_start, p_end) l;

  update payroll_adjustments
  set included_in_period_id = new_id
  where included_in_period_id is null;

  for rec in
    select t.cleaner_id, sum(t.minutes) as minutes, sum(t.holiday_minutes) as holiday_minutes
    from (
      select l.cleaner_id, l.minutes, case when l.kind = 'holiday' then l.minutes else 0 end as holiday_minutes
      from payroll_period_lines l where l.period_id = new_id
      union all
      select a.cleaner_id, a.minutes, 0 from payroll_adjustments a where a.included_in_period_id = new_id
    ) t
    where t.cleaner_id is not null
    group by t.cleaner_id
  loop
    insert into notifications (user_id, message)
    values (rec.cleaner_id,
      'Your hours for ' || to_char(p_start, 'DD Mon') || ' to ' || to_char(p_end - 1, 'DD Mon')
      || ' have gone to payroll: ' || payroll_format_minutes(rec.minutes)
      || case when rec.holiday_minutes > 0 then ' (including ' || payroll_format_minutes(rec.holiday_minutes) || ' holiday)' else '' end
      || '. Message the office if that is not right.');
  end loop;

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;
