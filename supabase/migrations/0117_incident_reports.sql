-- Accident and near-miss reporting: the accident book, in the app.
--
-- Until now an accident on a job reached the office as a phone call, or as
-- an "issue" on staff_requests next to a broken hoover - neither of which
-- is a record anyone could hand to an insurer or HSE. A near miss usually
-- reached nobody at all, and near misses are the ones worth hearing about:
-- they are the accident that has not happened yet.
--
-- One table for both, because they are the same form with the injury part
-- left off. Whoever was on site writes what happened; the office adds what
-- it found and what it changed, and decides whether it is RIDDOR
-- reportable. The staff half is never edited after it is sent - there is no
-- update policy for the reporter - so the record says what they said at
-- the time.
--
-- Nobody can delete a report from the app either. Accident book entries
-- are meant to be kept (three years at least), so only an admin can remove
-- one, and only by policy, with no button for it.

create table incident_reports (
  id uuid primary key default gen_random_uuid(),
  -- The only foreign key to profiles on this table, on purpose: a second
  -- path to profiles breaks every bare profiles() embed (0094/0095).
  -- reviewed_by below is a plain uuid for that reason.
  reported_by uuid not null references profiles(id),
  kind text not null check (kind in ('accident', 'near_miss')),
  occurred_at timestamptz not null,
  job_id uuid references jobs(id) on delete set null,
  location text not null,
  description text not null,

  -- Accident only. 'nobody' is an accident with damage and no injury (a
  -- broken ornament, a bleach spill on a carpet).
  injured_party text check (injured_party in ('me', 'colleague', 'client', 'public', 'nobody')),
  injured_name text,
  injury_details text,
  treatment text check (treatment in ('none', 'first_aid', 'gp', 'hospital')),
  damage_details text,

  immediate_action text,
  witnesses text,
  -- Paths in the incident-photos bucket, '<reported_by>/<file>'.
  photo_paths text[] not null default '{}',

  -- The office's half.
  status text not null default 'open' check (status in ('open', 'investigating', 'closed')),
  severity text check (severity in ('low', 'medium', 'high')),
  -- null until someone has decided, so "not reportable" is a decision
  -- rather than a default nobody looked at.
  riddor_reportable boolean,
  riddor_reference text,
  days_off_work integer check (days_off_work >= 0),
  root_cause text,
  corrective_action text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),

  -- A near miss has no injury part; an accident always says who was hurt,
  -- and says how they were treated exactly when somebody was.
  constraint incident_reports_accident_fields check (
    (kind = 'near_miss' and injured_party is null and treatment is null)
    or (kind = 'accident' and injured_party is not null
        and (injured_party = 'nobody') = (treatment is null))
  )
);

create index incident_reports_occurred_idx on incident_reports (occurred_at desc);
create index incident_reports_reporter_idx on incident_reports (reported_by);

alter table incident_reports enable row level security;

-- Anyone who can be sent to a job can report, and so can the office
-- (someone rings in, or it happened at the office). Clients cannot: a
-- client's complaint goes through client_requests. Same role list as the
-- emergency button (0113).
create policy "incident_reports: staff insert own" on incident_reports
  for insert with check (
    reported_by = auth.uid()
    and is_active_cleaner()
    and exists (
      select 1 from profiles
      where id = auth.uid() and role in ('cleaner', 'inventory', 'admin', 'supervisor')
    )
  );

create policy "incident_reports: reporter select own" on incident_reports
  for select using (reported_by = auth.uid());

-- Supervisors are often the ones on the phone when it happens, so they see
-- and follow up reports as well as admins - like emergency alerts.
create policy "incident_reports: office select" on incident_reports
  for select using (is_admin_or_supervisor());

create policy "incident_reports: office update" on incident_reports
  for update using (is_admin_or_supervisor()) with check (is_admin_or_supervisor());

create policy "incident_reports: admin delete" on incident_reports
  for delete using (is_admin());

-- The insert policy cannot stop a reporter filling in the office's columns
-- themselves (sending one in already "closed", or "not RIDDOR reportable").
-- Blanked here for anyone who is not the office.
create or replace function incident_reports_reset_office_fields() returns trigger as $$
begin
  if not is_admin_or_supervisor() then
    new.status := 'open';
    new.severity := null;
    new.riddor_reportable := null;
    new.riddor_reference := null;
    new.days_off_work := null;
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

drop trigger if exists incident_reports_reset_office_fields on incident_reports;
create trigger incident_reports_reset_office_fields
  before insert on incident_reports
  for each row execute procedure incident_reports_reset_office_fields();

-- And the office's update policy cannot stop the office rewriting what the
-- reporter said. An accident book that can be edited afterwards is worth
-- very little to an insurer, so the reporter's half is frozen here for
-- everyone. A correction goes in root_cause or corrective_action, beside
-- the original words rather than over them.
create or replace function incident_reports_freeze_report() returns trigger as $$
begin
  if (new.reported_by, new.kind, new.occurred_at, new.location, new.description,
      new.injured_party, new.injured_name, new.injury_details, new.treatment,
      new.damage_details, new.immediate_action, new.witnesses, new.photo_paths, new.created_at)
     is distinct from
     (old.reported_by, old.kind, old.occurred_at, old.location, old.description,
      old.injured_party, old.injured_name, old.injury_details, old.treatment,
      old.damage_details, old.immediate_action, old.witnesses, old.photo_paths, old.created_at) then
    raise exception 'The reported details of an accident or near miss cannot be changed';
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists incident_reports_freeze_report on incident_reports;
create trigger incident_reports_freeze_report
  before update on incident_reports
  for each row execute procedure incident_reports_freeze_report();

-- ---------------------------------------------------------------------------
-- Bell (and so push, 0086)
-- ---------------------------------------------------------------------------

-- A new report, to the office. Hospital treatment leads with URGENT so it
-- stands out on a lock screen among shift notifications.
create or replace function notify_office_on_incident_reported() returns trigger as $$
declare
  reporter_name text;
begin
  select full_name into reporter_name from public.profiles where id = new.reported_by;

  insert into public.notifications (user_id, message)
  select p.id,
    (case when new.treatment = 'hospital' then 'URGENT: ' else '' end)
    || (case when new.kind = 'accident' then 'Accident' else 'Near miss' end)
    || ' reported by ' || coalesce(reporter_name, 'a member of staff')
    || ' at ' || left(new.location, 60)
    || ' - ' || left(regexp_replace(new.description, '\s+', ' ', 'g'), 90)
  from public.profiles p
  where p.role in ('admin', 'supervisor')
    and p.id <> new.reported_by;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists incident_reports_notify_office on incident_reports;
create trigger incident_reports_notify_office
  after insert on incident_reports
  for each row execute procedure notify_office_on_incident_reported();

-- Closed, to whoever reported it, so a near miss someone took the trouble
-- to send in visibly went somewhere.
create or replace function notify_reporter_on_incident_closed() returns trigger as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed'
     and new.reported_by is distinct from auth.uid() then
    insert into public.notifications (user_id, message)
    values (new.reported_by,
      'The office has closed your '
      || (case when new.kind = 'accident' then 'accident' else 'near miss' end)
      || ' report from ' || to_char(new.occurred_at at time zone 'Europe/London', 'DD Mon')
      || coalesce(': ' || left(new.corrective_action, 90), '.'));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists incident_reports_notify_closed on incident_reports;
create trigger incident_reports_notify_closed
  after update of status on incident_reports
  for each row execute procedure notify_reporter_on_incident_closed();

-- ---------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------

-- Private, like staff-documents: an injury photo is health data. Files sit
-- under the reporter's own id, so the path alone says whose they are.
insert into storage.buckets (id, name, public) values ('incident-photos', 'incident-photos', false)
on conflict (id) do nothing;

drop policy if exists "incident-photos: staff upload own" on storage.objects;
create policy "incident-photos: staff upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'incident-photos'
    and split_part(name, '/', 1) = auth.uid()::text
    and is_active_cleaner()
  );

drop policy if exists "incident-photos: own or office read" on storage.objects;
create policy "incident-photos: own or office read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'incident-photos'
    and (split_part(name, '/', 1) = auth.uid()::text or is_admin_or_supervisor())
  );

drop policy if exists "incident-photos: admin delete" on storage.objects;
create policy "incident-photos: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'incident-photos' and is_admin());
