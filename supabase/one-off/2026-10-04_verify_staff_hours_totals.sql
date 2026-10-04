-- Run AFTER 0121_staff_hours_totals_and_indexes.sql. Reads only; changes nothing.
--
-- Checks staff_hours_totals() against the rule the holiday-balance trigger
-- already uses (assignment_paid_minutes(), 0094), person by person. The
-- function only answers for office staff, and the SQL editor has no signed-in
-- user, so the block below borrows an admin's identity for this one
-- transaction and rolls back.
--
-- Expected result: one row per member of staff with `matches` true, and a
-- summary row (sorted to the top) reading `-- 0 mismatches`.

begin;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', (select id from profiles where role = 'admin' order by created_at limit 1), 'role', 'authenticated')::text,
  true
);

with fn as (
  select * from staff_hours_totals()
),
trigger_rule as (
  select ja.cleaner_id, sum(assignment_paid_minutes(ja.job_id, ja.cleaner_id)) as minutes, count(*) as assignments
  from job_assignments ja
  group by ja.cleaner_id
),
compared as (
  select
    p.full_name,
    round(fn.worked_minutes / 60.0, 2) as function_hours,
    round(coalesce(tr.minutes, 0) / 60.0, 2) as trigger_rule_hours,
    fn.assignment_count,
    coalesce(tr.assignments, 0) as trigger_rule_assignments,
    fn.holiday_approved_hours,
    fn.holiday_pending_hours,
    abs(fn.worked_minutes - coalesce(tr.minutes, 0)) < 0.01
      and fn.assignment_count = coalesce(tr.assignments, 0) as matches
  from fn
  join profiles p on p.id = fn.cleaner_id
  left join trigger_rule tr on tr.cleaner_id = fn.cleaner_id
)
select full_name, function_hours, trigger_rule_hours, assignment_count, trigger_rule_assignments,
       holiday_approved_hours, holiday_pending_hours, matches::text
from compared
union all
select '-- ' || count(*) filter (where not matches) || ' mismatches', null, null, null, null, null, null, null
from compared
order by 1;

rollback;
