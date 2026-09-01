-- Let the office put a missed shift right without waiting to be asked.
--
-- 0076 gave the cleaner a way to say "I worked that" and an admin a way to
-- confirm it. But the person who notices is very often the admin: they are
-- the one looking at a rota with a red job on it, or a payroll panel that is
-- four hours short, and they frequently already know the answer - the client
-- rang to say the cleaner had been, or they spoke to them at the time.
--
-- Making them wait for a claim in that situation is pointless ceremony, and
-- worse, it puts the burden on the person who has already lost the hours. So
-- an admin can now confirm the shift directly.
--
-- This is job-level, not per-cleaner, because hours are job-level: a job's
-- duration is split evenly across everyone assigned and paid on the job
-- reaching 'completed'. There is deliberately no way here to say "one of the
-- two turned up" - the hours model cannot express it, and a button implying
-- otherwise would be lying about what it did.

-- Which route the record came in by. Both end in the same place - an
-- approved claim, an attendance row, a completed job - but "they told us and
-- we agreed" and "we recorded it ourselves" are not the same statement, and
-- an attendance record staff can be pulled up on has to keep them apart. The
-- same reasoning as auto_checked_out (0072) and self_declared (0076).
alter table missed_clockin_claims
  add column if not exists raised_by_admin boolean not null default false;

-- Everything decide_missed_clockin_claim() does on approval, minus the claim
-- that would have triggered it. Kept as a separate function rather than a
-- flag on that one because the entry conditions genuinely differ: there is no
-- claim to look up, no 'already_decided' to guard, and the job itself has to
-- be checked as still missable - a claim carries that guarantee with it via
-- 0076's insert policy, and this does not.
create or replace function admin_confirm_missed_shift(
  target_job_id uuid,
  note text default null
) returns text as $$
declare
  target jobs;
  assignee record;
  claimed_from timestamptz;
  claimed_to timestamptz;
  assignee_count int;
begin
  if not is_admin_or_supervisor() then return 'not_allowed'; end if;

  select * into target from jobs where id = target_job_id for update;
  if not found then return 'not_found'; end if;

  -- The same two limbs as 0076's insert policy: already marked missed, or
  -- overdue and still saying 'scheduled' because reconcile_job_statuses()
  -- only runs when somebody opens a page. Anything else is not a lost shift
  -- and must not be quietly completed from here - in particular a job still
  -- in progress, which somebody is standing in the middle of.
  if not (
    target.status = 'missed'
    or (target.status = 'scheduled'
        and target.scheduled_at + (target.duration_minutes || ' minutes')::interval < now())
  ) then
    return 'not_missed';
  end if;

  select count(*) into assignee_count from job_assignments where job_id = target_job_id;
  -- Nobody assigned is a rota problem, not a clock-in problem. Completing it
  -- would pay nobody anything while hiding the job from the unassigned count
  -- that is trying to tell the admin something is wrong.
  if assignee_count = 0 then return 'no_assignees'; end if;

  claimed_from := target.scheduled_at;
  claimed_to := target.scheduled_at + (coalesce(target.duration_minutes, 120) || ' minutes')::interval;

  for assignee in select cleaner_id from job_assignments where job_id = target_job_id loop
    -- A cleaner who already asked gets their own claim approved rather than a
    -- second one written alongside it. Otherwise an admin confirming a job
    -- somebody had just raised would leave the original sitting pending in
    -- the queue for ever, and 0076's unique index would reject the insert.
    update missed_clockin_claims
    set status = 'approved',
        admin_note = coalesce(note, admin_note),
        decided_by = auth.uid(),
        decided_at = now()
    where job_id = target_job_id and cleaner_id = assignee.cleaner_id and status = 'pending';

    if not found then
      insert into missed_clockin_claims (
        job_id, cleaner_id, worked_from, worked_to, reason,
        status, admin_note, decided_by, decided_at, raised_by_admin
      ) values (
        target_job_id, assignee.cleaner_id, claimed_from, claimed_to, null,
        'approved', note, auth.uid(), now(), true
      );
    end if;

    -- Same attendance row 0076 writes, and self_declared for the same reason:
    -- nobody pressed a button at the door, and the record must not suggest
    -- they did.
    if not exists (
      select 1 from checkins where job_id = target_job_id and cleaner_id = assignee.cleaner_id
    ) then
      insert into checkins (job_id, cleaner_id, checked_in_at, checked_out_at, self_declared)
      values (target_job_id, assignee.cleaner_id, claimed_from, claimed_to, true);
    end if;

    insert into notifications (user_id, message)
    values (assignee.cleaner_id,
      'The office has recorded you as having worked a shift you did not clock in for'
      || coalesce(' - ' || note, '')
      || '. Those hours now count towards your pay and holiday.');
  end loop;

  -- The line that actually puts the hours back, exactly as in
  -- decide_missed_clockin_claim(). checkins_sync_job_status will not do it:
  -- the rows above are inserted with a checked_out_at already set, so on a
  -- job where every assignee gets one it would reach 'completed' on its own,
  -- but on a job where somebody already had a check-in it would not.
  update jobs set status = 'completed'
  where id = target_job_id and status <> 'completed';

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function admin_confirm_missed_shift(uuid, text) to authenticated;
