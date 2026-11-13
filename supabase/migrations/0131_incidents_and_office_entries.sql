-- Accident book: incidents, office-entered reports, and admins only
-- (follows 0117 and 0130).
--
-- 1. Incidents. Not everything that goes wrong on a job hurts someone: a
--    lost key, a door left unlocked, a client shouting at a cleaner, a
--    bleach spill, something broken or missing. Those had nowhere to go but
--    an "accident with nobody hurt". Now there are three kinds:
--      accident  - someone was hurt
--      incident  - something else went wrong (incident_type says what)
--      near_miss - nobody was hurt, but someone could have been
--    Damage with nobody hurt is now an incident ('damage'). 'nobody' stays
--    allowed on accidents so nothing already saved breaks, but the form no
--    longer offers it.
--
-- 2. The office can add a report itself: someone rang it in, or it is an
--    old entry copied from the paper accident book. told_by records who it
--    came from. When an admin is the recorder and has no home address on
--    file, the accident book's "recorder's address" is the company's
--    registered office.
--
-- 3. Admins only. A report holds injury details, which are health data, and
--    UK GDPR asks that as few people as possible see it. Supervisors are
--    already kept out of the rest of the staff record (0092); Jess decided
--    on 2026-11-13 that the accident book goes the same way. Supervisors can
--    still send a report and see the ones they sent, as anyone can.

-- ---------------------------------------------------------------------------
-- Kinds and incident types
-- ---------------------------------------------------------------------------

alter table incident_reports drop constraint if exists incident_reports_kind_check;
alter table incident_reports add constraint incident_reports_kind_check
  check (kind in ('accident', 'incident', 'near_miss'));

alter table incident_reports
  add column if not exists incident_type text check (incident_type in (
    'damage', 'theft_or_loss', 'keys_or_access', 'aggression', 'security',
    'spill_fire_flood', 'safeguarding', 'other')),
  add column if not exists told_by text;

alter table incident_reports drop constraint if exists incident_reports_accident_fields;
alter table incident_reports add constraint incident_reports_accident_fields check (
  (kind in ('near_miss', 'incident') and injured_party is null and treatment is null)
  or (kind = 'accident' and injured_party is not null
      and (injured_party = 'nobody') = (treatment is null))
);

alter table incident_reports drop constraint if exists incident_reports_incident_type;
alter table incident_reports add constraint incident_reports_incident_type
  check ((kind = 'incident') = (incident_type is not null));

-- ---------------------------------------------------------------------------
-- Admins only
-- ---------------------------------------------------------------------------

drop policy if exists "incident_reports: office select" on incident_reports;
drop policy if exists "incident_reports: admin select" on incident_reports;
create policy "incident_reports: admin select" on incident_reports
  for select using (is_admin());

drop policy if exists "incident_reports: office update" on incident_reports;
drop policy if exists "incident_reports: admin update" on incident_reports;
create policy "incident_reports: admin update" on incident_reports
  for update using (is_admin()) with check (is_admin());

-- A supervisor's own report now arrives with the office fields blanked,
-- like anyone else's. told_by is the office's too: staff report their own.
create or replace function incident_reports_reset_office_fields() returns trigger as $$
begin
  if not is_admin() then
    new.told_by := null;
    new.status := 'open';
    new.severity := null;
    new.injured_status := null;
    new.accident_kind := null;
    new.body_part := null;
    new.off_work := false;
    new.back_at_work_on := null;
    new.riddor_category := null;
    new.riddor_reported_on := null;
    new.riddor_reference := null;
    new.insurer_notified_on := null;
    new.client_notified_on := null;
    new.risk_assessment_reviewed_on := null;
    new.root_cause := null;
    new.corrective_action := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.closed_at := null;
  end if;
  new.created_at := now();
  return new;
end;
$$ language plpgsql set search_path = public;

-- As 0130, plus the registered office as an admin recorder's address.
create or replace function incident_reports_fill_identity() returns trigger as $$
declare
  reporter jsonb;
  reporter_address text;
  self_employed boolean;
  occupation text;
begin
  select to_jsonb(p) into reporter from public.profiles p where p.id = new.reported_by;
  select d.address into reporter_address from public.staff_details d where d.profile_id = new.reported_by;
  if reporter_address is null and reporter ->> 'role' = 'admin' then
    select nullif(trim(c.registered_office), '') into reporter_address from public.company_settings c limit 1;
  end if;
  self_employed := coalesce(reporter ->> 'employment_type', 'employee') = 'subcontractor';
  occupation := case reporter ->> 'role'
      when 'cleaner' then 'Cleaning Operative'
      when 'supervisor' then 'Cleaning Supervisor'
      when 'inventory' then 'Inventory Clerk'
      when 'admin' then 'Office staff'
      else initcap(coalesce(reporter ->> 'role', 'staff'))
    end || case when self_employed then ' (self-employed)' else '' end;

  if new.injured_party = 'me' then
    new.injured_address := coalesce(nullif(trim(new.injured_address), ''), reporter_address);
    new.injured_occupation := coalesce(nullif(trim(new.injured_occupation), ''), occupation);
    new.recorded_by_address := null;
    new.recorded_by_occupation := null;
  elsif new.kind = 'accident' and new.injured_party <> 'nobody' then
    new.recorded_by_address := reporter_address;
    new.recorded_by_occupation := occupation;
  else
    new.injured_address := null;
    new.injured_occupation := null;
    new.recorded_by_address := null;
    new.recorded_by_occupation := null;
  end if;

  if new.injured_status is null then
    new.injured_status := case
      when new.injured_party = 'me' then case when self_employed then 'self_employed' else 'employee' end
      when new.injured_party in ('client', 'public') then 'non_worker'
      else null
    end;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- As 0130, with incident_type and told_by frozen too.
create or replace function incident_reports_freeze_report() returns trigger as $$
begin
  if (new.reported_by, new.kind, new.incident_type, new.told_by, new.occurred_at, new.location, new.description,
      new.injured_party, new.injured_name, new.injury_details, new.treatment,
      new.damage_details, new.immediate_action, new.witnesses, new.photo_paths,
      new.recorded_by_address, new.recorded_by_occupation, new.created_at)
     is distinct from
     (old.reported_by, old.kind, old.incident_type, old.told_by, old.occurred_at, old.location, old.description,
      old.injured_party, old.injured_name, old.injury_details, old.treatment,
      old.damage_details, old.immediate_action, old.witnesses, old.photo_paths,
      old.recorded_by_address, old.recorded_by_occupation, old.created_at)
     or (old.injured_address is not null and new.injured_address is distinct from old.injured_address)
     or (old.injured_occupation is not null and new.injured_occupation is distinct from old.injured_occupation) then
    raise exception 'The reported details of an accident, incident or near miss cannot be changed';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

-- The bell carries the start of the description, which can describe an
-- injury, so it goes to admins only.
create or replace function notify_office_on_incident_reported() returns trigger as $$
declare
  reporter_name text;
begin
  select full_name into reporter_name from public.profiles where id = new.reported_by;

  insert into public.notifications (user_id, message)
  select p.id,
    (case when new.treatment = 'hospital' then 'URGENT: ' else '' end)
    || (case new.kind when 'accident' then 'Accident' when 'incident' then 'Incident' else 'Near miss' end)
    || ' reported by ' || coalesce(reporter_name, 'a member of staff')
    || ' at ' || left(new.location, 60)
    || ' - ' || left(regexp_replace(new.description, '\s+', ' ', 'g'), 90)
  from public.profiles p
  where p.role = 'admin'
    and p.id <> new.reported_by;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function notify_reporter_on_incident_closed() returns trigger as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed'
     and new.reported_by is distinct from auth.uid() then
    insert into public.notifications (user_id, message)
    values (new.reported_by,
      'The office has closed your '
      || (case new.kind when 'accident' then 'accident' when 'incident' then 'incident' else 'near miss' end)
      || ' report from ' || to_char(new.occurred_at at time zone 'Europe/London', 'DD Mon')
      || coalesce(': ' || left(new.corrective_action, 90), '.'));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop policy if exists "incident-photos: own or office read" on storage.objects;
drop policy if exists "incident-photos: own or admin read" on storage.objects;
create policy "incident-photos: own or admin read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'incident-photos'
    and (split_part(name, '/', 1) = auth.uid()::text or is_admin())
  );
