-- Night worker health questionnaire (Working Time Regulations 1998, reg 7).
--
-- Night workers must be offered a free health assessment before they start
-- nights and at regular intervals after that. A questionnaire is an
-- accepted first step. This is the app version of the Word form
-- ("Night Worker Health Questionnaire.docx"), so cleaners can fill it in on
-- their phones.
--
-- Health data, so kept apart:
--   * Its own table, not columns on profiles, staff_details or
--     profile_private, and nothing in staff documents.
--   * A cleaner can send their own and read their own. Nobody can read
--     anyone else's except admins (role = 'admin', is_admin()). Supervisors
--     and other cleaners cannot. Jess chose "all admins" on 2026-11-15.
--   * Nobody edits a cleaner's answers once sent, and nothing in the app
--     deletes one: keep for as long as they work nights and two years
--     after, as the Word form says. Removal is done by hand in SQL.
--
-- Also a short list of who works nights, so the app can ask them to fill
-- it in and ask again when their review is due.
--
-- One FK to profiles per table (0094/0095): reviewed_by and added_by are
-- plain uuids.

-- ---------------------------------------------------------------------------
-- Who works nights
-- ---------------------------------------------------------------------------

create table if not exists night_workers (
  profile_id uuid primary key references profiles(id) on delete cascade,
  added_by uuid,
  added_at timestamptz not null default now()
);

alter table night_workers enable row level security;

drop policy if exists "night_workers: own or admin read" on night_workers;
create policy "night_workers: own or admin read" on night_workers
  for select using (profile_id = auth.uid() or is_admin());

drop policy if exists "night_workers: admin add" on night_workers;
create policy "night_workers: admin add" on night_workers
  for insert with check (is_admin());

drop policy if exists "night_workers: admin remove" on night_workers;
create policy "night_workers: admin remove" on night_workers
  for delete using (is_admin());

-- The night workers on 2026-11-15: Christopher Carter, and Callum Nolan,
-- who covers nights. Skipped quietly if either id is not there.
insert into night_workers (profile_id)
select id from profiles
where id in ('8b706b00-a2ce-4f30-888d-fbd8cebd064d', '2295fd8a-fcf1-4705-ac32-813c1d49f434')
on conflict (profile_id) do nothing;

-- ---------------------------------------------------------------------------
-- The questionnaires
-- ---------------------------------------------------------------------------

create table if not exists night_health_questionnaires (
  id uuid primary key default gen_random_uuid(),
  -- No on delete: a profile with a health record cannot be deleted from
  -- under it. Staff are deactivated, not deleted.
  profile_id uuid not null references profiles(id),

  -- Your details
  role_and_site text,
  shift_pattern text,

  -- Your health: "Do you have, or are you being treated for..."
  diabetes boolean not null,
  heart_circulation boolean not null,
  breathing boolean not null,
  digestive boolean not null,
  epilepsy boolean not null,
  sleep boolean not null,
  mental_health boolean not null,
  other_condition boolean not null,
  medication boolean not null,
  pregnancy boolean not null,
  tired_unwell boolean not null,
  other_job_caring boolean not null,

  -- Anything else
  details text,

  -- Your choice
  wants_assessment boolean not null,

  -- Signature: they type their name to confirm.
  signed_name text not null check (length(trim(signed_name)) > 1),
  signed_on date not null default ((now() at time zone 'Europe/London')::date),
  submitted_at timestamptz not null default now(),

  -- For office use only
  reviewed_by uuid,
  reviewed_on date,
  outcome text check (outcome in ('fit', 'referred', 'adjustments')),
  office_notes text,
  next_review_due date,

  constraint night_health_review_within_a_year
    check (next_review_due is null or reviewed_on is null or next_review_due <= reviewed_on + interval '12 months')
);

create index if not exists night_health_questionnaires_profile_idx
  on night_health_questionnaires(profile_id, submitted_at desc);

alter table night_health_questionnaires enable row level security;

drop policy if exists "night_health: own or admin read" on night_health_questionnaires;
create policy "night_health: own or admin read" on night_health_questionnaires
  for select using (profile_id = auth.uid() or is_admin());

drop policy if exists "night_health: send own" on night_health_questionnaires;
create policy "night_health: send own" on night_health_questionnaires
  for insert with check (profile_id = auth.uid());

drop policy if exists "night_health: admin review" on night_health_questionnaires;
create policy "night_health: admin review" on night_health_questionnaires
  for update using (is_admin()) with check (is_admin());

-- No delete policy: nobody deletes one through the app.

-- On the way in: the office half starts blank and the dates are the
-- server's, whoever sends it.
create or replace function night_health_on_insert() returns trigger as $$
begin
  new.reviewed_by := null;
  new.reviewed_on := null;
  new.outcome := null;
  new.office_notes := null;
  new.next_review_due := null;
  new.submitted_at := now();
  new.signed_on := (now() at time zone 'Europe/London')::date;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists night_health_on_insert on night_health_questionnaires;
create trigger night_health_on_insert before insert on night_health_questionnaires
  for each row execute function night_health_on_insert();

-- Reviewing: only the office half can change, and the reviewer is whoever
-- is signed in.
create or replace function night_health_on_update() returns trigger as $$
begin
  if (new.profile_id, new.role_and_site, new.shift_pattern,
      new.diabetes, new.heart_circulation, new.breathing, new.digestive, new.epilepsy, new.sleep,
      new.mental_health, new.other_condition, new.medication, new.pregnancy, new.tired_unwell,
      new.other_job_caring, new.details, new.wants_assessment, new.signed_name, new.signed_on,
      new.submitted_at)
     is distinct from
     (old.profile_id, old.role_and_site, old.shift_pattern,
      old.diabetes, old.heart_circulation, old.breathing, old.digestive, old.epilepsy, old.sleep,
      old.mental_health, old.other_condition, old.medication, old.pregnancy, old.tired_unwell,
      old.other_job_caring, old.details, old.wants_assessment, old.signed_name, old.signed_on,
      old.submitted_at) then
    raise exception 'A sent questionnaire''s answers cannot be changed';
  end if;
  new.reviewed_by := auth.uid();
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists night_health_on_update on night_health_questionnaires;
create trigger night_health_on_update before update on night_health_questionnaires
  for each row execute function night_health_on_update();

-- Tell the admins one has arrived. The message names the person only, never
-- an answer, since notifications are not kept confidential. Definer so a
-- cleaner's insert can write other people's notifications.
create or replace function night_health_notify_admins() returns trigger as $$
declare
  sender text;
begin
  select full_name into sender from profiles where id = new.profile_id;
  insert into notifications (user_id, message)
  select p.id,
    coalesce(sender, 'A night worker') || ' has sent a night worker health questionnaire - review it under Records, Night worker health.'
  from profiles p
  where p.role = 'admin';
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists night_health_notify_admins on night_health_questionnaires;
create trigger night_health_notify_admins after insert on night_health_questionnaires
  for each row execute function night_health_notify_admins();

-- New functions are executable by PUBLIC (and so the anon key) by default.
-- These are trigger functions only; nobody calls them directly.
revoke execute on function night_health_on_insert() from public, anon, authenticated;
revoke execute on function night_health_on_update() from public, anon, authenticated;
revoke execute on function night_health_notify_admins() from public, anon, authenticated;

-- Tables: nothing for the anon key at all.
revoke all on night_workers from anon;
revoke all on night_health_questionnaires from anon;
