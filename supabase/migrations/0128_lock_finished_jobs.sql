-- Once a visit is completed or missed, who was on it and whether it
-- happened are part of the record - nobody changes them from the app.
--
-- On 2026-10-28 the office took Laura off two pub cleans she had done on
-- the 25th and put John on them. Pay follows the assignment on a completed
-- job (lib/hoursWorked.js), not the clock-in, so her hours went to him and
-- her check-ins were left on jobs showing his name. The same morning a
-- Slate Street visit was deleted, and its check-in went with it, since
-- checkins cascade from jobs. The rota already refuses to move a visit
-- that has started; it let both of these through.
--
-- What stays open on a finished job is the correcting of hours: the Hours
-- button (paid_minutes), a length change, a short-shift confirmation or a
-- missed clock-in claim. Those are updates to existing rows and are not
-- touched here. Payroll close (0082) already carries any of them into the
-- next run.
--
-- in_progress is deliberately not locked: a stray or half-started visit
-- still needs tidying, and the office can only do that while it is open.
--
-- auth.uid() is null only for service-role and SQL-editor callers (0037),
-- which is how a genuine mistake on a finished job gets repaired - on
-- purpose, by someone who has looked, and written to audit_log (0107).

create or replace function lock_finished_job_assignments() returns trigger as $$
declare
  job_status text;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE'
     and new.job_id is not distinct from old.job_id
     and new.cleaner_id is not distinct from old.cleaner_id then
    return new;
  end if;

  -- A job being deleted has already gone by the time its assignments
  -- cascade, so this finds nothing and the cascade goes ahead; deleting a
  -- finished job is refused by the trigger on jobs before it gets here.
  select status into job_status from jobs where id = coalesce(old.job_id, new.job_id);
  if job_status in ('completed', 'missed') then
    raise exception 'This visit is %, so the staff on it can''t be changed.', job_status
      using hint = 'Use Hours to correct what someone is paid for it.';
  end if;

  if tg_op = 'UPDATE' then
    select status into job_status from jobs where id = new.job_id;
    if job_status in ('completed', 'missed') then
      raise exception 'This visit is %, so the staff on it can''t be changed.', job_status;
    end if;
  end if;

  return coalesce(new, old);
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists lock_finished_job_assignments on job_assignments;
create trigger lock_finished_job_assignments
  before insert or delete or update of job_id, cleaner_id on job_assignments
  for each row execute procedure lock_finished_job_assignments();

create or replace function lock_finished_job_delete() returns trigger as $$
begin
  if auth.uid() is not null and old.status in ('completed', 'missed') then
    raise exception 'This visit is %, so it can''t be deleted.', old.status;
  end if;
  return old;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists lock_finished_job_delete on jobs;
create trigger lock_finished_job_delete
  before delete on jobs
  for each row execute procedure lock_finished_job_delete();

-- Definer functions are callable by anyone with the anon key unless
-- revoked; these are trigger-only.
revoke execute on function lock_finished_job_assignments() from public, anon, authenticated;
revoke execute on function lock_finished_job_delete() from public, anon, authenticated;
