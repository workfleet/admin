-- Training is booked on the rota, like the stock take before it.
--
-- Training already existed in this app twice over: eight how-to videos
-- somebody watches on their own (0077), and staff_certifications (0050),
-- which is the dated record that matters to a commercial client. Neither
-- of them puts an hour in the day. So a fire-safety morning or a COSHH
-- refresher was arranged by message, never appeared on the rota, and the
-- office could still book that person a clean straight through it.
--
-- Rather than a second kind of thing the rota has to learn to draw, a
-- training session is a job with kind = 'training'. That is the same call
-- 0113 made for the stock take, and it is what makes this small: the
-- week grid, the by-cleaner sheet, the cleaner's own rota, clock-in,
-- double-booking and travel checks, the approved-holiday clash warning
-- and payroll all read `jobs`, and every one of them now covers training
-- without being told about it.
--
-- Two things fall out of that, both wanted:
--
--   * Who can see it. "jobs: cleaner own" (0030) is membership through
--     job_assignments, so the people booked on the training see it. The
--     client policy (0002) is `property_id in client_property_ids()`, and
--     a training job has no property - null is never in that list - so no
--     client can see it, ever. That is enforced below rather than left to
--     the office remembering: a training job may not carry a property at
--     all, so a training session cannot be leaked onto a client's portal
--     by picking an address out of the dropdown.
--
--   * Who it pays. An hour of training is a paid hour, so it reaches
--     payroll as worked time exactly as a clean does, off the back of the
--     same check-in. Only the line's label needs help, because a training
--     session has no property to take an address from.

alter table jobs
  add column if not exists kind text not null default 'clean'
    check (kind in ('clean', 'training')),
  -- What the training is - "Fire safety refresher". Takes the place of the
  -- client address on the rota block, which is the line the office reads
  -- to know what a block is.
  add column if not exists training_title text,
  -- Free text, not a property. Training happens at head office, a hotel
  -- function room, a supplier's depot - places that are not clients and
  -- must never become client records just to get an hour on the rota.
  add column if not exists training_location text,
  add column if not exists training_trainer text,
  -- Set when this session is the kind that earns a dated certificate, and
  -- left null when it is not. Naming the certificate here is what lets
  -- attendance write it to staff_certifications on completion, instead of
  -- the office re-typing eight names after the room empties.
  add column if not exists training_certification_name text,
  add column if not exists training_certification_expiry date;

alter table jobs drop constraint if exists jobs_training_has_title;
alter table jobs add constraint jobs_training_has_title
  check (kind <> 'training' or nullif(btrim(training_title), '') is not null);

-- The guarantee that keeps training off client portals. See above.
alter table jobs drop constraint if exists jobs_training_has_no_property;
alter table jobs add constraint jobs_training_has_no_property
  check (kind <> 'training' or property_id is null);

-- A clean carries no training text. Without this the columns quietly
-- become a second notes field on ordinary jobs, and "is this a training
-- session" stops having one answer.
alter table jobs drop constraint if exists jobs_training_fields_only_on_training;
alter table jobs add constraint jobs_training_fields_only_on_training
  check (
    kind = 'training'
    or (training_title is null
        and training_location is null
        and training_trainer is null
        and training_certification_name is null
        and training_certification_expiry is null)
  );

create index if not exists jobs_kind_idx on jobs(kind) where kind <> 'clean';

-- A monthly toolbox talk repeats like any other booking, and a repeating
-- job gets a job_series row to hang the pattern on. That row has always
-- required a property, which a training has not got - so without this a
-- repeating training would quietly lose its series and become a handful
-- of unrelated bookings that the series editor could no longer change
-- together. Relaxed rather than given a fake property, because inventing
-- a property is what the constraint above exists to prevent.
alter table job_series alter column property_id drop not null;

-- ---------------------------------------------------------------------
-- Attendance writes the certificate
-- ---------------------------------------------------------------------

-- Which session a certificate came out of. Also what makes the write
-- idempotent: a job can reach 'completed' more than once (0076's missed
-- clock-in claims and 0078's admin confirmation both set it), and nobody
-- should collect the same certificate twice for one morning.
alter table staff_certifications
  add column if not exists training_job_id uuid references jobs(id) on delete set null;

create unique index if not exists staff_certifications_training_job_staff_idx
  on staff_certifications(training_job_id, staff_id)
  where training_job_id is not null;

-- Attendance is a check-in, not an assignment.
--
-- For a clean, "who was absent" is missed_shift_outcomes (0096) - the
-- office records why somebody was not there. That is the right test for
-- pay and the wrong one for a certificate: it treats anyone the office
-- has not got round to marking as present. A certificate is the thing a
-- client audits, so it is issued on evidence instead - the person clocked
-- in to the session. reconcile_job_statuses() (0098) only ever completes
-- a job somebody checked into, so a session nobody turned up to goes to
-- 'missed' and issues nothing at all.
create or replace function record_training_certifications() returns trigger as $$
begin
  if new.kind <> 'training' then return new; end if;
  if new.status <> 'completed' or coalesce(old.status, '') = 'completed' then return new; end if;
  if nullif(btrim(coalesce(new.training_certification_name, '')), '') is null then return new; end if;

  insert into staff_certifications (staff_id, name, expiry_date, notes, training_job_id)
  select
    c.cleaner_id,
    btrim(new.training_certification_name),
    new.training_certification_expiry,
    'Attended ' || btrim(new.training_title)
      || ' on ' || to_char(new.scheduled_at, 'DD Mon YYYY')
      || coalesce(', run by ' || nullif(btrim(new.training_trainer), ''), ''),
    new.id
  from checkins c
  where c.job_id = new.id
    and c.checked_in_at is not null
  group by c.cleaner_id
  on conflict do nothing;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- security definer above is on purpose: staff_certifications is
-- admin/supervisor only (0050), and the update that completes a training
-- job is usually the last attendee clocking out - so the write has to
-- outrank whoever happens to be holding the session open.
--
-- 0106's rule all the same: a new function is callable with the public key
-- until it is told otherwise. A trigger function is not reachable through
-- PostgREST anyway, but the rule is worth keeping without exceptions - the
-- one that gets forgotten is the one that is not.
revoke execute on function record_training_certifications() from public, anon;

drop trigger if exists jobs_record_training_certifications on jobs;
create trigger jobs_record_training_certifications
  after update of status on jobs
  for each row execute procedure record_training_certifications();

-- ---------------------------------------------------------------------
-- Payroll
-- ---------------------------------------------------------------------

-- Unchanged from 0108 but for the address expression: a training session
-- has no property, so a left join gives payroll a blank line where every
-- other row names somewhere. It stays kind = 'worked' - Jess's call, and
-- the same one 0113 made for the stock take - so the hours land in pay
-- and accrue holiday like any other; only the label is different, so a
-- pay run reads "Training: Fire safety refresher" rather than nothing.
--
-- Replaced rather than dropped, so 0106's grants survive.
create or replace function payroll_period_lines_for(p_start date, p_end date)
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
      case
        when j.kind = 'training'
          then 'Training: ' || coalesce(nullif(btrim(j.training_title), ''), 'session')
        else p.address
      end,
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
