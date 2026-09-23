-- Read-only proof that 0115 works end to end, run in the Supabase SQL editor.
--
-- Everything happens inside a transaction that is rolled back at the end, so
-- nothing below survives: no training job, no check-in, no certificate. Run
-- it whole - if you only run part of it you will leave the transaction open.
--
-- It proves the two things a REST probe cannot reach from outside:
--
--   1. The trigger writes a certificate to the people who CHECKED IN to a
--      training session, and not to the person who was booked on it but
--      never turned up.
--   2. payroll_period_lines_for's new address expression actually runs and
--      labels a training line, rather than leaving payroll a blank address.

begin;

-- Two real staff to stand in as attendees. Whoever comes back first is the
-- one who "attends"; the second is booked on but never checks in.
create temporary table probe_staff on commit drop as
  select id, full_name, row_number() over (order by full_name) as n
  from profiles
  where role in ('cleaner', 'inventory') and active
  limit 2;

create temporary table probe_job on commit drop as
  with j as (
    insert into jobs (kind, training_title, training_location, training_trainer,
                      training_certification_name, training_certification_expiry,
                      scheduled_at, duration_minutes, status)
    values ('training', 'Probe: fire safety refresher', 'Head office', 'Dan Powell',
            'Probe certificate', date '2029-03-01',
            now() - interval '3 hours', 120, 'scheduled')
    returning id
  )
  select id from j;

-- Both are booked on the session.
insert into job_assignments (job_id, cleaner_id)
select (select id from probe_job), s.id from probe_staff s;

-- Only the first one actually turns up.
insert into checkins (job_id, cleaner_id, checked_in_at, checked_out_at)
select (select id from probe_job), s.id,
       now() - interval '3 hours', now() - interval '1 hour'
from probe_staff s where s.n = 1;

-- The session finishes. This is the update the trigger hangs off.
update jobs set status = 'completed' where id = (select id from probe_job);

-- ---- 1. Who got the certificate -------------------------------------
-- EXPECT exactly one row, for the person who checked in, named
-- "Probe certificate", expiring 2029-03-01, with a notes line naming the
-- session and the trainer. The second person must NOT appear.
select 'certificates written' as check,
       p.full_name,
       c.name,
       c.expiry_date,
       c.notes
from staff_certifications c
join profiles p on p.id = c.staff_id
where c.training_job_id = (select id from probe_job);

-- EXPECT: attended = 1, booked_on = 2. If these are equal, the trigger is
-- issuing certificates on assignment rather than attendance.
select 'attendance, not assignment' as check,
       (select count(*) from staff_certifications
         where training_job_id = (select id from probe_job)) as attended,
       (select count(*) from job_assignments
         where job_id = (select id from probe_job)) as booked_on;

-- EXPECT still 1 row, not 2 - completing twice must not hand out the
-- certificate again.
update jobs set status = 'scheduled' where id = (select id from probe_job);
update jobs set status = 'completed' where id = (select id from probe_job);
select 'no duplicate on re-completion' as check,
       count(*) as should_still_be_one
from staff_certifications where training_job_id = (select id from probe_job);

-- ---- 2. What payroll calls it ---------------------------------------
-- The new expression out of payroll_period_lines_for, run directly - the
-- function itself checks is_admin() and returns nothing in the SQL editor.
-- EXPECT "Training: Probe: fire safety refresher", not a blank.
select 'payroll label' as check,
       case
         when j.kind = 'training'
           then 'Training: ' || coalesce(nullif(btrim(j.training_title), ''), 'session')
         else p.address
       end as job_address
from jobs j
left join properties p on p.id = j.property_id
where j.id = (select id from probe_job);

-- ---- 3. A session nobody attended ------------------------------------
-- EXPECT 0 rows: no check-in, so no certificate, even though someone was
-- booked on it.
create temporary table probe_empty on commit drop as
  with j as (
    insert into jobs (kind, training_title, training_certification_name,
                      scheduled_at, duration_minutes, status)
    values ('training', 'Probe: nobody came', 'Probe certificate',
            now() - interval '3 hours', 60, 'scheduled')
    returning id
  ) select id from j;

insert into job_assignments (job_id, cleaner_id)
select (select id from probe_empty), s.id from probe_staff s where s.n = 1;

update jobs set status = 'completed' where id = (select id from probe_empty);

select 'nobody attended' as check,
       count(*) as should_be_zero
from staff_certifications where training_job_id = (select id from probe_empty);

-- Nothing above is kept.
rollback;
