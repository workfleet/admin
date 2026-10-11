-- The office approves who covers a shift.
--
-- Until now the first cleaner to tap "I'll take it" was put straight on the
-- shift (0070). The office wants the say: a cleaner asks for a shift, the
-- office sees everyone who asked and approves one, and only then does it go
-- on that cleaner's rota.
--
-- So claim_shift_offer() now records a request instead of assigning, and
-- the offer stays open while people ask. Approving is the Cover page's
-- existing Assign (admin policies), which is also how the office has always
-- put someone on by hand. Whoever closes an offer, the trigger below tells
-- the person who released it and everyone who asked and did not get it.

alter table shift_offer_responses drop constraint if exists shift_offer_responses_response_check;
alter table shift_offer_responses add constraint shift_offer_responses_response_check
  check (response in ('accepted', 'declined', 'requested', 'turned_down'));

-- Same checks as 0119, so a cleaner is told at once if they cannot do it -
-- the office should only ever be choosing between people who are free.
-- Returns 'requested' on success; the other codes are unchanged.
create or replace function claim_shift_offer(target_offer_id uuid) returns text as $$
declare
  offer record;
  job record;
  caller_role text;
  caller_name text;
  job_date date;
begin
  select * into offer from shift_offers where id = target_offer_id;
  if not found then return 'not_found'; end if;
  if offer.status <> 'open' then return 'already_taken'; end if;
  if offer.expires_at is not null and offer.expires_at <= now() then return 'expired'; end if;

  select role, full_name into caller_role, caller_name from profiles where id = auth.uid();
  if caller_role <> 'cleaner' or not is_active_cleaner() or not caller_takes_cover() then
    return 'not_eligible';
  end if;
  if offer.released_by = auth.uid() then return 'already_on_job'; end if;

  select * into job from jobs where id = offer.job_id;
  if not found then return 'not_found'; end if;
  if job.scheduled_at <= now() or job.status <> 'scheduled' then return 'too_late'; end if;

  if exists (select 1 from job_assignments where job_id = offer.job_id and cleaner_id = auth.uid()) then
    return 'already_on_job';
  end if;

  job_date := (job.scheduled_at at time zone 'Europe/London')::date;

  if exists (
    select 1 from time_off_requests t
    where t.cleaner_id = auth.uid()
      and t.status = 'approved'
      and job_date between t.start_date and t.end_date
  ) then
    return 'on_time_off';
  end if;

  if exists (
    select 1 from job_assignments ja
    join jobs other on other.id = ja.job_id
    where ja.cleaner_id = auth.uid()
      and other.id <> job.id
      and other.status in ('scheduled', 'in_progress')
      and tstzrange(other.scheduled_at,
                    other.scheduled_at + make_interval(mins => coalesce(other.duration_minutes, 60)))
          && tstzrange(job.scheduled_at,
                       job.scheduled_at + make_interval(mins => coalesce(job.duration_minutes, 60)))
  ) then
    return 'clashes';
  end if;

  if exists (
    select 1 from shift_offer_responses
    where offer_id = target_offer_id and cleaner_id = auth.uid() and response = 'requested'
  ) then
    return 'already_requested';
  end if;

  -- A "Not me" earlier, or an earlier request the office turned down, is
  -- replaced: asking again is a fresh ask.
  insert into shift_offer_responses (offer_id, cleaner_id, response)
  values (target_offer_id, auth.uid(), 'requested')
  on conflict (offer_id, cleaner_id) do update set response = 'requested', created_at = now();

  insert into notifications (user_id, message)
  select p.id,
    coalesce(caller_name, 'A cleaner') || ' has asked to cover the shift on '
    || to_char(job.scheduled_at at time zone 'Europe/London', 'DD Mon at HH24:MI')
    || ' - approve it on the Cover page.'
  from profiles p
  where p.role in ('admin', 'supervisor');

  return 'requested';
end;
$$ language plpgsql security definer set search_path = public;

-- Changing your mind before the office has answered.
create or replace function withdraw_cover_request(target_offer_id uuid) returns text as $$
begin
  delete from shift_offer_responses
  where offer_id = target_offer_id and cleaner_id = auth.uid() and response = 'requested';
  if not found then return 'not_found'; end if;
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

-- The office saying no to one person without closing the offer.
create or replace function turn_down_cover_request(target_offer_id uuid, target_cleaner_id uuid) returns text as $$
declare
  job_when timestamptz;
begin
  if not is_admin_or_supervisor() then return 'not_allowed'; end if;

  update shift_offer_responses set response = 'turned_down', created_at = now()
  where offer_id = target_offer_id and cleaner_id = target_cleaner_id and response = 'requested';
  if not found then return 'not_found'; end if;

  select j.scheduled_at into job_when
  from shift_offers so join jobs j on j.id = so.job_id
  where so.id = target_offer_id;

  insert into notifications (user_id, message)
  values (
    target_cleaner_id,
    'The office has given the shift on '
    || to_char(job_when at time zone 'Europe/London', 'DD Mon at HH24:MI')
    || ' to someone else this time - thanks for offering.'
  );
  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function claim_shift_offer(uuid) from public, anon;
revoke execute on function withdraw_cover_request(uuid) from public, anon;
revoke execute on function turn_down_cover_request(uuid, uuid) from public, anon;
grant execute on function claim_shift_offer(uuid) to authenticated;
grant execute on function withdraw_cover_request(uuid) to authenticated;
grant execute on function turn_down_cover_request(uuid, uuid) to authenticated;

-- Whoever closes an offer - the Cover page, the Requests page, a cancel -
-- the people waiting on it hear the outcome. The approved cleaner is told
-- by the assignment itself (notify_on_job_assignment, 0030).
create or replace function notify_on_shift_offer_closed() returns trigger as $$
declare
  job_when text;
begin
  if old.status <> 'open' or new.status = 'open' then
    return new;
  end if;

  select to_char(j.scheduled_at at time zone 'Europe/London', 'DD Mon at HH24:MI') into job_when
  from public.jobs j where j.id = new.job_id;

  if new.status = 'filled' then
    update public.shift_offer_responses set response = 'accepted', created_at = now()
    where offer_id = new.id and cleaner_id = new.filled_by;

    if new.released_by is not null and new.released_by is distinct from new.filled_by then
      insert into public.notifications (user_id, message)
      values (new.released_by, 'Your shift on ' || job_when || ' has been covered - it is off your rota.');
    end if;
  end if;

  insert into public.notifications (user_id, message)
  select r.cleaner_id,
    case when new.status = 'filled'
      then 'The shift on ' || job_when || ' has gone to someone else - thanks for offering.'
      else 'The shift on ' || job_when || ' no longer needs cover.'
    end
  from public.shift_offer_responses r
  where r.offer_id = new.id
    and r.response = 'requested'
    and r.cleaner_id is distinct from new.filled_by;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function notify_on_shift_offer_closed() from public, anon, authenticated;

drop trigger if exists on_shift_offer_closed on shift_offers;
create trigger on_shift_offer_closed
  after update of status on shift_offers
  for each row execute procedure notify_on_shift_offer_closed();
