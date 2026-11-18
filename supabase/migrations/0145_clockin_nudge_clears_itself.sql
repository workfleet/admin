-- A "You haven't clocked in" reminder goes away once you have.
--
-- The clock-in nudge (api/admin/clockin-nudge) writes a bell entry 15
-- minutes after a shift starts if nobody is on the clock. Nothing ever took
-- it back down. Christopher Carter starts the 23:00 Bus Station shift
-- later than that most nights, clocks in, works it, and the next morning his
-- home screen still reads "You haven't clocked in at Swansea City Bus
-- Station" - which he quite reasonably took to mean the app had him down as
-- missing shifts he worked (Nov 2026). Both shifts it was about are
-- completed and paid.
--
-- The bell row now records which job it is about, and is dismissed for that
-- person the moment they clock in on it, or for everyone once the job is
-- completed (a colleague's clock-in, an approved claim, the office marking
-- it worked). A shift that really was missed keeps its reminder.

alter table notifications
  add column if not exists job_id uuid;

-- Deliberately no foreign key: a second relationship between notifications
-- and another table is the kind of thing that turns a bare PostgREST embed
-- ambiguous, and nothing needs to embed through this. A deleted job leaves a
-- harmless dangling id that purgeOldNotifications clears with the row.

create index if not exists notifications_job_id_idx
  on notifications (job_id)
  where job_id is not null and dismissed_at is null;

-- Clocking in: this person's reminder for this job.
create or replace function dismiss_clockin_nudge_on_checkin() returns trigger as $$
begin
  update notifications
  set dismissed_at = now()
  where job_id = new.job_id
    and user_id = new.cleaner_id
    and dismissed_at is null;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function dismiss_clockin_nudge_on_checkin() from public, anon, authenticated;

drop trigger if exists checkins_dismiss_clockin_nudge on checkins;
create trigger checkins_dismiss_clockin_nudge
  after insert or update of checked_in_at on checkins
  for each row
  when (new.checked_in_at is not null)
  execute function dismiss_clockin_nudge_on_checkin();

-- The job completing: nobody needs telling to clock in on it any more.
create or replace function dismiss_clockin_nudges_on_completion() returns trigger as $$
begin
  update notifications
  set dismissed_at = now()
  where job_id = new.id
    and dismissed_at is null;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function dismiss_clockin_nudges_on_completion() from public, anon, authenticated;

drop trigger if exists jobs_dismiss_clockin_nudges on jobs;
create trigger jobs_dismiss_clockin_nudges
  after update of status on jobs
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function dismiss_clockin_nudges_on_completion();

-- The reminders already sitting in people's bells have no job on them, so
-- they can't be matched. Any more than 12 hours old is about a shift that
-- has long finished: one that was worked is recorded, and one that was not
-- is on the cleaner's My Hours page and the office's Requests page, which is
-- where it gets put right. The bell copy is only noise now.
update notifications
set dismissed_at = now()
where dismissed_at is null
  and job_id is null
  and message like 'You haven''t clocked in at %'
  and created_at < now() - interval '12 hours';
