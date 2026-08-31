-- Being auto-checked-out must be undoable. 0072 let the app close a shift
-- on a cleaner's behalf, but a closed check-in also locks the job - no
-- photos, no ticking tasks, no way back in - and that lock was only ever
-- meant to follow a decision someone made deliberately. Nipping to the
-- shop mid-job shouldn't end the shift behind them with no way back.

-- When the app made the call, which is not the same as the time it wrote
-- down: the catch-up pass records a departure at the job's allotted end,
-- possibly hours before it ran. The grace window for resuming has to run
-- from the guess, not from the guessed-at time, or it would already have
-- expired the moment it was written.
alter table checkins
  add column if not exists auto_checked_out_at timestamptz;

-- Reopening a check-in needs to touch jobs, which cleaners deliberately
-- can't write to (see 0038), so it goes through a definer function rather
-- than widening that back up. Status codes rather than exceptions, as in
-- claim_shift_offer/cancel_shift_offer (0070) - the caller needs to tell
-- "you're too late" from "that went wrong" to say anything useful.
create or replace function resume_auto_checkout(target_checkin_id uuid) returns text as $$
declare
  target checkins;
begin
  select * into target from checkins where id = target_checkin_id for update;
  if not found then return 'not_found'; end if;

  -- Definer functions bypass RLS, so every condition the "checkins:
  -- cleaner own" policy would have applied is restated here by hand.
  if target.cleaner_id is distinct from auth.uid()
     or not is_active_cleaner()
     or not is_assigned_to_job(target.job_id) then
    return 'not_yours';
  end if;

  -- Only the app's own guesses are reversible. A cleaner who pressed
  -- Check Out made a decision, and that stands.
  if not target.auto_checked_out then return 'not_automatic'; end if;
  if target.checked_out_at is null then return 'already_open'; end if;

  -- The same 30 minutes the app offers the button for. Enforced here too,
  -- because this reopens a completed job and a stale page left open in a
  -- pocket shouldn't be able to reach back into last week's work.
  if target.auto_checked_out_at is null
     or now() - target.auto_checked_out_at > interval '30 minutes' then
    return 'expired';
  end if;

  update checkins
  set checked_out_at = null,
      auto_checked_out = false,
      auto_checked_out_at = null,
      last_seen_inside_at = now()
  where id = target_checkin_id;

  -- sync_job_status_from_checkins() only ever promotes a 'scheduled' job,
  -- so a job that reached 'completed' - either because everyone had
  -- checked out, or because reconcile_job_statuses() timed it out - has to
  -- be reopened here explicitly.
  update jobs set status = 'in_progress'
  where id = target.job_id and status <> 'in_progress';

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function resume_auto_checkout(uuid) to authenticated;
