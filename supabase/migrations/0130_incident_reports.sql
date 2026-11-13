-- Accident book: the fields the law asks for (upgrades 0117).
--
-- 0117 made incident_reports and has been run on the live project, but no
-- page that uses it had shipped and the table is empty. It recorded what
-- happened and a yes/no for RIDDOR. That is not enough to stand as the
-- accident book or to keep RIDDOR deadlines. This adds:
--
--   * Accident book (Social Security (Claims and Payments) Regs 1979,
--     reg 25): the injured person's address and occupation, and the
--     address and occupation of whoever made the entry when it was not the
--     injured person. The recorder's details, and an injured reporter's
--     own, are copied from their staff record on the way in, so nobody has
--     to type them at the scene.
--   * RIDDOR 2013: a category in place of yes/no (so "record only, over 3
--     days" and "report within 15 days" are different answers), the date
--     it went to HSE, and time off counted the way RIDDOR counts it (from
--     the day after the accident, weekends included). That needs whether
--     they were off and the day they went back, rather than a number
--     someone works out by hand. Also HSE's "kind of accident", the part of
--     the body, and whether the injured person is an employee, self-
--     employed or not a worker, which decides who reports it.
--   * Management of Health and Safety at Work Regs 1999: the date the risk
--     assessment was looked at again. And the dates the insurer and the
--     client were told.
--   * Kept at least three years (RIDDOR reg 12). Admin delete is now
--     refused until then. Nothing in the app deletes a report.
--
-- Safe to run with rows in the table: riddor_reportable and days_off_work
-- are carried across before they are dropped.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table incident_reports
  -- The reporter's half (frozen by incident_reports_freeze_report).
  -- The office may fill in a blank injured address or occupation later (a
  -- client's address the cleaner did not know), but never change one.
  add column if not exists injured_address text,
  add column if not exists injured_occupation text,
  -- Copied by trigger, never sent by the app.
  add column if not exists recorded_by_address text,
  add column if not exists recorded_by_occupation text,

  -- The office's half.
  add column if not exists injured_status text
    check (injured_status in ('employee', 'self_employed', 'non_worker')),
  -- HSE's own list from the online form, so the summary can be copied
  -- straight across.
  add column if not exists accident_kind text check (accident_kind in (
    'machinery', 'struck_by_object', 'struck_by_vehicle', 'hit_fixed_object',
    'handling_lifting', 'slip_trip_same_level', 'fall_from_height', 'trapped_collapse',
    'drowned_asphyxiated', 'harmful_substance', 'fire', 'explosion', 'electricity',
    'animal', 'assault', 'other')),
  add column if not exists body_part text,
  -- Off work, or unable to do their normal work, from the day after the
  -- accident until back_at_work_on (null while off_work = still off).
  add column if not exists off_work boolean not null default false,
  add column if not exists back_at_work_on date,
  -- null until someone has decided, so "not reportable" is a decision
  -- rather than a default nobody looked at.
  add column if not exists riddor_category text check (riddor_category in (
    'not_reportable', 'over_3_day_record_only', 'over_7_day', 'specified_injury', 'death',
    'non_worker_hospital', 'occupational_disease', 'dangerous_occurrence')),
  add column if not exists riddor_reported_on date,
  add column if not exists insurer_notified_on date,
  add column if not exists client_notified_on date,
  add column if not exists risk_assessment_reviewed_on date;

alter table incident_reports drop constraint if exists incident_reports_back_after_off;
alter table incident_reports add constraint incident_reports_back_after_off
  check (back_at_work_on is null or off_work);

-- Carry the old answers across. A "yes" had no category, so it keeps its
-- reference and is left for the office to categorise.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'incident_reports' and column_name = 'riddor_reportable') then
    execute $q$
      update incident_reports set
        off_work = coalesce(days_off_work, 0) > 0,
        riddor_category = case when riddor_reportable = false then 'not_reportable' end,
        riddor_reported_on = case when riddor_reportable then created_at::date end
    $q$;
  end if;
end $$;

alter table incident_reports drop column if exists riddor_reportable;
alter table incident_reports drop column if exists days_off_work;

comment on column incident_reports.reported_by is
  'The only FK to profiles on this table (0094/0095). No on delete: a profile with an accident on record cannot be deleted from under the accident book.';

-- ---------------------------------------------------------------------------
-- Keep for three years at least
-- ---------------------------------------------------------------------------

-- RIDDOR reg 12 sets three years from the accident as the floor. A claim
-- can come later than that, and a child's much later, so this is a floor,
-- not a schedule: nothing removes old reports on its own.
drop policy if exists "incident_reports: admin delete" on incident_reports;
drop policy if exists "incident_reports: admin delete after three years" on incident_reports;
create policy "incident_reports: admin delete after three years" on incident_reports
  for delete using (is_admin() and occurred_at < now() - interval '3 years');

-- ---------------------------------------------------------------------------
-- On the way in
-- ---------------------------------------------------------------------------

-- As 0117, with the new office columns blanked for anyone not the office.
create or replace function incident_reports_reset_office_fields() returns trigger as $$
begin
  if not is_admin_or_supervisor() then
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

-- Fills in the accident book's identity fields from the staff record, so
-- an injured cleaner is not asked for their own address at the scene, and
-- guesses who reports it to HSE (the office can change it).
--
-- There is no job title on profiles; the role is the nearest thing to an
-- occupation. A subcontractor says so. employment_type comes from 0104,
-- which has not been run on the live project everywhere, so it is read
-- through to_jsonb and is simply absent until it has.
--
-- Definer so it reads staff_details whoever is reporting (supervisors
-- cannot otherwise read it, 0092). It only ever reads the reporter's row.
-- Must run after the reset above, which blanks injured_status: triggers on
-- the same event fire in name order, hence the z_ prefix.
create or replace function incident_reports_fill_identity() returns trigger as $$
declare
  reporter jsonb;
  reporter_address text;
  self_employed boolean;
  occupation text;
begin
  select to_jsonb(p) into reporter from public.profiles p where p.id = new.reported_by;
  select d.address into reporter_address from public.staff_details d where d.profile_id = new.reported_by;
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

drop trigger if exists z_incident_reports_fill_identity on incident_reports;
create trigger z_incident_reports_fill_identity
  before insert on incident_reports
  for each row execute procedure incident_reports_fill_identity();

-- As 0117: the reporter's half is frozen for everyone, now including the
-- recorder's details. The injured person's address and occupation may be
-- filled in once if they were left blank, then they are frozen too.
create or replace function incident_reports_freeze_report() returns trigger as $$
begin
  if (new.reported_by, new.kind, new.occurred_at, new.location, new.description,
      new.injured_party, new.injured_name, new.injury_details, new.treatment,
      new.damage_details, new.immediate_action, new.witnesses, new.photo_paths,
      new.recorded_by_address, new.recorded_by_occupation, new.created_at)
     is distinct from
     (old.reported_by, old.kind, old.occurred_at, old.location, old.description,
      old.injured_party, old.injured_name, old.injury_details, old.treatment,
      old.damage_details, old.immediate_action, old.witnesses, old.photo_paths,
      old.recorded_by_address, old.recorded_by_occupation, old.created_at)
     or (old.injured_address is not null and new.injured_address is distinct from old.injured_address)
     or (old.injured_occupation is not null and new.injured_occupation is distinct from old.injured_occupation) then
    raise exception 'The reported details of an accident or near miss cannot be changed';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;
