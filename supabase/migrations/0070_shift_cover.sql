-- Sick-cover marketplace: when a cleaner can't make a shift, the shift is
-- offered to everyone else who's free and the first eligible person to
-- accept takes it over - instead of an admin ringing round at 6am.
--
-- The releasing cleaner stays assigned to the job until someone actually
-- claims it. That's deliberate: an unfilled offer must never leave a
-- client's job with nobody on it and nobody watching, so "I can't make
-- this" opens a cover request, it doesn't walk away from the shift.
--
-- Contract clause 4.3 already requires staff to tell the company as soon
-- as they can't attend - this is that message, with the cover attached.

create table shift_offers (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null,
  -- Set when a cleaner released their own shift; null when admin opened
  -- the offer to find extra cover for a job nobody's on yet.
  released_by uuid references profiles(id) on delete set null,
  opened_by uuid references profiles(id) on delete set null,
  reason text,
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  expires_at timestamptz,
  filled_by uuid references profiles(id) on delete set null,
  filled_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create index shift_offers_job_id_idx on shift_offers(job_id);
create index shift_offers_status_idx on shift_offers(status, created_at desc);

-- One live cover request per job - two open offers for the same shift
-- would let two people each think they'd covered it.
create unique index shift_offers_one_open_per_job on shift_offers(job_id) where status = 'open';

-- Who was asked and what they said. Accepting is recorded here too (by
-- claim_shift_offer below) so the trail reads the same either way.
create table shift_offer_responses (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid references shift_offers(id) on delete cascade not null,
  cleaner_id uuid references profiles(id) on delete cascade not null,
  response text not null check (response in ('accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (offer_id, cleaner_id)
);

create index shift_offer_responses_offer_id_idx on shift_offer_responses(offer_id);

alter table shift_offers enable row level security;
alter table shift_offer_responses enable row level security;

-- security definer for the same reason as assigned_job_ids() in 0030 -
-- these are read from inside jobs/properties policies and mustn't
-- recurse back through RLS.
create or replace function open_offer_job_ids() returns setof uuid as $$
  select job_id from shift_offers
  where status = 'open' and (expires_at is null or expires_at > now())
$$ language sql security definer stable;

create or replace function open_offer_property_ids() returns setof uuid as $$
  select j.property_id from shift_offers so
  join jobs j on j.id = so.job_id
  where so.status = 'open' and (so.expires_at is null or so.expires_at > now())
$$ language sql security definer stable;

create policy "shift_offers: admin or supervisor manage" on shift_offers
  for all using (is_admin_or_supervisor());

-- Every active cleaner sees open offers (that's the marketplace), plus
-- any offer they released or filled themselves so it stays in their
-- history after it closes.
create policy "shift_offers: cleaner select" on shift_offers
  for select using (
    is_active_cleaner()
    and (status = 'open' or released_by = auth.uid() or filled_by = auth.uid())
  );

create policy "shift_offers: cleaner release own shift" on shift_offers
  for insert with check (
    released_by = auth.uid()
    and is_active_cleaner()
    and is_assigned_to_job(job_id)
    and status = 'open'
    and filled_by is null
  );

-- Note there is no cleaner UPDATE policy: claiming and cancelling both
-- go through the security definer functions below, so a cleaner can
-- never write status/filled_by directly and skip the eligibility checks.

create policy "shift_offer_responses: admin or supervisor manage" on shift_offer_responses
  for all using (is_admin_or_supervisor());

create policy "shift_offer_responses: cleaner select own" on shift_offer_responses
  for select using (cleaner_id = auth.uid());

create policy "shift_offer_responses: cleaner insert own" on shift_offer_responses
  for insert with check (cleaner_id = auth.uid() and is_active_cleaner());

-- Claiming has to be atomic: two cleaners tapping Accept at the same
-- moment must not both end up thinking they got the shift. The row lock
-- on the offer serialises them - the first commits as 'filled', the
-- second wakes up, re-reads the now-filled row and gets 'already_taken'.
-- Returns a result code rather than raising, so the app can show a
-- specific, honest reason instead of a generic failure.
create or replace function claim_shift_offer(target_offer_id uuid) returns text as $$
declare
  offer record;
  job record;
  caller_role text;
  job_date date;
begin
  select * into offer from shift_offers where id = target_offer_id for update;
  if not found then return 'not_found'; end if;
  if offer.status <> 'open' then return 'already_taken'; end if;
  if offer.expires_at is not null and offer.expires_at <= now() then return 'expired'; end if;

  select role into caller_role from profiles where id = auth.uid();
  if caller_role <> 'cleaner' or not is_active_cleaner() then return 'not_eligible'; end if;

  select * into job from jobs where id = offer.job_id;
  if not found then return 'not_found'; end if;
  if job.scheduled_at <= now() or job.status <> 'scheduled' then return 'too_late'; end if;

  if exists (select 1 from job_assignments where job_id = offer.job_id and cleaner_id = auth.uid()) then
    return 'already_on_job';
  end if;

  -- Time off is stored as plain dates, so the shift's timestamp has to
  -- be read in UK local time to land on the right day - in BST a 00:30
  -- UTC shift belongs to the following date.
  job_date := (job.scheduled_at at time zone 'Europe/London')::date;

  if exists (
    select 1 from time_off_requests t
    where t.cleaner_id = auth.uid()
      and t.status = 'approved'
      and job_date between t.start_date and t.end_date
  ) then
    return 'on_time_off';
  end if;

  -- duration_minutes has no default in every environment, so fall back
  -- to an hour rather than letting a null collapse the range to a point
  -- and wave through a genuine double-booking.
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

  if offer.released_by is not null then
    delete from job_assignments where job_id = offer.job_id and cleaner_id = offer.released_by;
  end if;

  -- Fires notify_on_job_assignment() from 0030, so the claimer gets the
  -- same "new shift assigned" notification as any other assignment.
  insert into job_assignments (job_id, cleaner_id)
  values (offer.job_id, auth.uid())
  on conflict (job_id, cleaner_id) do nothing;

  update shift_offers
  set status = 'filled', filled_by = auth.uid(), filled_at = now()
  where id = target_offer_id;

  insert into shift_offer_responses (offer_id, cleaner_id, response)
  values (target_offer_id, auth.uid(), 'accepted')
  on conflict (offer_id, cleaner_id) do update set response = 'accepted', created_at = now();

  if offer.released_by is not null then
    insert into notifications (user_id, message)
    values (
      offer.released_by,
      'Your shift on ' || to_char(job.scheduled_at, 'DD Mon at HH24:MI') || ' has been covered.'
    );
  end if;

  insert into notifications (user_id, message)
  select p.id,
    'Cover found: ' || coalesce(claimer.full_name, 'A cleaner')
    || ' has taken the shift on ' || to_char(job.scheduled_at, 'DD Mon at HH24:MI') || '.'
  from profiles p
  cross join (select full_name from profiles where id = auth.uid()) claimer
  where p.role in ('admin', 'supervisor');

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

-- Pulling your own cover request back (found someone yourself, or you're
-- well again). Admins cancel through the normal admin policy instead.
create or replace function cancel_shift_offer(target_offer_id uuid) returns text as $$
declare
  offer record;
begin
  select * into offer from shift_offers where id = target_offer_id for update;
  if not found then return 'not_found'; end if;
  if offer.released_by is distinct from auth.uid() then return 'not_yours'; end if;
  if offer.status <> 'open' then return 'already_taken'; end if;

  update shift_offers
  set status = 'cancelled', cancelled_at = now()
  where id = target_offer_id;

  return 'ok';
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function claim_shift_offer(uuid) to authenticated;
grant execute on function cancel_shift_offer(uuid) to authenticated;

-- Admin needs to know a shift is uncovered the moment it's released,
-- not when someone happens to open the rota.
create or replace function notify_on_shift_offer_opened() returns trigger as $$
declare
  releaser_name text;
  job_when timestamptz;
begin
  if new.status <> 'open' or new.released_by is null then
    return new;
  end if;

  select full_name into releaser_name from public.profiles where id = new.released_by;
  select scheduled_at into job_when from public.jobs where id = new.job_id;

  insert into public.notifications (user_id, message)
  select p.id,
    coalesce(releaser_name, 'A cleaner') || ' can''t make the shift on '
    || to_char(job_when, 'DD Mon at HH24:MI') || ' - cover needed.'
  from public.profiles p
  where p.role in ('admin', 'supervisor');

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_shift_offer_opened
  after insert on shift_offers
  for each row execute procedure notify_on_shift_offer_opened();
