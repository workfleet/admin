-- A way back from a forgotten clock-in, so worked hours still reach payroll.
--
-- Today, forgetting to press Check In does not produce a slightly wrong
-- shift length - it deletes the shift. reconcile_job_statuses() (0034)
-- marks a job 'missed' when its allotted end passes with no check-in row,
-- and lib/hoursWorked.js only ever counts jobs at status 'completed'. So a
-- job somebody genuinely worked pays nothing, and because holiday accrues
-- at 12.07% of hours worked (enforce_holiday_balance(), 0030), they lose
-- the holiday it earned as well. Neither the cleaner nor an admin can undo
-- it: nothing in the app writes jobs.status by hand, and a late check-in
-- needs them to still be standing inside the 75m geofence.
--
-- Note this only bites when NOBODY on the job clocked in. Hours are per
-- assignment on a completed job, so on a two-hander where one person
-- clocked in, the job completes and both are paid - the one who forgot is
-- already covered. What follows is for the job nobody clocked into.
--
-- Shape is the one this app already uses for anything a cleaner asks for
-- and an admin decides on (time_off_requests 0022, reschedule_requests
-- 0055): request, approve, audit. Deliberately not a button that lets a
-- cleaner mark their own job worked - the onboarding agreement has a
-- clause about falsified clock-in records, and self-declared time that
-- nobody signed off would make that clause unenforceable.

-- A shift recorded from what someone told us afterwards, not from a button
-- they pressed at the door. 0072 added auto_checked_out for the same reason
-- and says why: this is an attendance record staff can be pulled up on, so
-- "they clocked in", "we inferred it from their phone" and "they told us
-- later and an admin agreed" must never look identical to whoever reads it
-- back. Three cases now, three ways to tell them apart.
alter table checkins
  add column if not exists self_declared boolean not null default false;

-- Prevention, not just cure. The nudge sweep (api/admin/clockin-nudge) runs
-- on a timer and needs somewhere to remember that it has already prodded
-- someone about a given job, or every run would send the same alert again.
alter table jobs
  add column if not exists clockin_nudge_sent_at timestamptz;

create table missed_clockin_claims (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null,
  cleaner_id uuid references profiles(id) on delete cascade not null,
  -- What they say they actually worked. Prefilled in the UI from the booked
  -- times, because that is what payroll would have paid anyway and it is
  -- the answer on almost every claim - but typed in rather than assumed,
  -- so an approving admin is signing off a statement someone made.
  worked_from timestamptz not null,
  worked_to timestamptz not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  admin_note text,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (worked_to > worked_from)
);

create index missed_clockin_claims_job_id_idx on missed_clockin_claims(job_id);
create index missed_clockin_claims_cleaner_id_idx on missed_clockin_claims(cleaner_id);

-- One open claim per person per job. A second one is either a double-tap
-- or an attempt to get a different answer out of a different admin; a
-- decided claim leaves the way clear to raise a corrected one.
create unique index missed_clockin_claims_one_pending_idx
  on missed_clockin_claims(job_id, cleaner_id)
  where status = 'pending';

alter table missed_clockin_claims enable row level security;

-- Only for a job that is actually lost. Both limbs matter: 'missed' is set
-- lazily by reconcile_job_statuses() when an admin happens to load the rota,
-- so a long-overdue job can still be sitting at 'scheduled' hours later,
-- and a cleaner should not have to wait for someone else to open a page
-- before they can put their own hours right.
--
-- worked_to <= now() keeps this a record of work done rather than a booking:
-- there is no reason to declare a shift that has not finished yet, and every
-- reason not to let one be declared in advance.
create policy "missed_clockin_claims: cleaner insert own" on missed_clockin_claims
  for insert with check (
    cleaner_id = auth.uid()
    and is_active_cleaner()
    and is_assigned_to_job(job_id)
    and worked_to <= now()
    and exists (
      select 1 from jobs j
      where j.id = job_id
        and (
          j.status = 'missed'
          or (j.status = 'scheduled'
              and j.scheduled_at + (j.duration_minutes || ' minutes')::interval < now())
        )
    )
  );

-- Select, not "for all": once submitted it is evidence, and the person it
-- is evidence about does not get to edit or withdraw it.
create policy "missed_clockin_claims: cleaner select own" on missed_clockin_claims
  for select using (cleaner_id = auth.uid());

create policy "missed_clockin_claims: admin or supervisor manage" on missed_clockin_claims
  for all using (is_admin_or_supervisor());

-- An unclaimed shift is unpaid until someone looks at it, and payroll runs
-- to a date. Same pattern as notify_admins_on_reschedule_request (0055).
create or replace function notify_admins_on_missed_clockin_claim() returns trigger as $$
declare
  cleaner_name text;
  job_address text;
begin
  select full_name into cleaner_name from profiles where id = new.cleaner_id;
  select p.address into job_address
  from jobs j join properties p on p.id = j.property_id where j.id = new.job_id;

  insert into notifications (user_id, message)
  select id,
    coalesce(cleaner_name, 'A cleaner') || ' says they worked '
    || coalesce(job_address, 'a job') || ' on '
    || to_char(new.worked_from, 'DD Mon') || ' but did not clock in'
  from profiles where role in ('admin', 'supervisor');

  return new;
end;
$$ language plpgsql security definer;

create trigger missed_clockin_claim_notifies_admins
  after insert on missed_clockin_claims
  for each row execute procedure notify_admins_on_missed_clockin_claim();

-- Approving has to write to jobs, which cleaners cannot touch (0038) and
-- which nothing in the app writes status to by hand, so it goes through a
-- definer function - same reasoning as resume_auto_checkout (0073). Status
-- codes rather than exceptions, so the caller can tell "someone already
-- dealt with this" from "that went wrong".
create or replace function decide_missed_clockin_claim(
  target_claim_id uuid,
  decision text,
  note text default null
) returns text as $$
declare
  target missed_clockin_claims;
  existing_checkin uuid;
begin
  if decision not in ('approved', 'declined') then return 'bad_decision'; end if;

  select * into target from missed_clockin_claims where id = target_claim_id for update;
  if not found then return 'not_found'; end if;

  -- Definer functions bypass RLS, so the condition the "admin or supervisor
  -- manage" policy would have applied is restated here by hand.
  if not is_admin_or_supervisor() then return 'not_allowed'; end if;
  if target.status <> 'pending' then return 'already_decided'; end if;

  update missed_clockin_claims
  set status = decision,
      admin_note = note,
      decided_by = auth.uid(),
      decided_at = now()
  where id = target_claim_id;

  if decision = 'declined' then
    insert into notifications (user_id, message)
    values (target.cleaner_id, 'Your missed clock-in claim was declined'
      || coalesce(' - ' || note, '') || '. Message the office if that is not right.');
    return 'ok';
  end if;

  -- The attendance record. Written even though hours are derived from the
  -- job's booked duration rather than from these timestamps, because the
  -- check-in row is what anyone reading the shift back later actually looks
  -- at, and a paid shift with no attendance row at all reads as a mistake.
  -- self_declared is what stops it reading as a clock-in that happened.
  select id into existing_checkin
  from checkins where job_id = target.job_id and cleaner_id = target.cleaner_id;

  if existing_checkin is null then
    insert into checkins (job_id, cleaner_id, checked_in_at, checked_out_at, self_declared)
    values (target.job_id, target.cleaner_id, target.worked_from, target.worked_to, true);
  end if;

  -- checkins_sync_job_status (0030) only ever promotes a job out of
  -- 'scheduled', so a job that has already been marked 'missed' will not be
  -- picked up by the insert above and has to be set here explicitly. This is
  -- the line that actually puts the hours back: lib/hoursWorked.js counts
  -- assignments on 'completed' jobs and nothing else.
  update jobs set status = 'completed'
  where id = target.job_id and status <> 'completed';

  insert into notifications (user_id, message)
  values (target.cleaner_id, 'Your missed clock-in was approved - those hours now count towards your pay and holiday.');

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function decide_missed_clockin_claim(uuid, text, text) to authenticated;

-- 'missed' has been a one-way door, and it should never have been.
--
-- sync_job_status_from_checkins (0030) only ever promoted a job out of
-- 'scheduled'. So a cleaner who ran late, got marked missed at their booked
-- end time, then arrived and checked in properly, left a job sitting at
-- 'missed' with a real check-in row against it - and reconcile_job_statuses
-- (0034) only auto-completes from 'in_progress', so it never recovered
-- either. Unpaid, off a genuine clock-in, with nothing on any screen to
-- suggest anything had gone wrong.
--
-- Whether they were late is not something status should be deciding. A job
-- somebody actually clocked into is in progress, whatever the rota expected,
-- and the missed count on the rota should stop counting it the moment
-- somebody walks in the door.
create or replace function sync_job_status_from_checkins() returns trigger as $$
declare
  target_job_id uuid := coalesce(new.job_id, old.job_id);
  assigned_count int;
  checked_in_count int;
  checked_out_count int;
begin
  select count(*) into assigned_count from job_assignments where job_id = target_job_id;
  select count(*) into checked_in_count from checkins where job_id = target_job_id and checked_in_at is not null;
  select count(*) into checked_out_count from checkins where job_id = target_job_id and checked_out_at is not null;

  if assigned_count > 0 and checked_out_count >= assigned_count then
    update jobs set status = 'completed' where id = target_job_id and status <> 'completed';
  elsif checked_in_count > 0 then
    update jobs set status = 'in_progress' where id = target_job_id and status in ('scheduled', 'missed');
  end if;

  return new;
end;
$$ language plpgsql security definer;

-- Existing damage, not just the path that caused it: any job still sitting
-- at 'missed' with somebody checked into it has been unpaid since the day it
-- ran. reconcile_job_statuses() will carry these the rest of the way to
-- 'completed' the next time an admin opens the rota, exactly as it would
-- have done at the time.
update jobs set status = 'in_progress'
where status = 'missed'
  and exists (select 1 from checkins c where c.job_id = jobs.id and c.checked_in_at is not null);
