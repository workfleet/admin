-- Site warnings, and reminders for open accident reports (follows 0131; 0134 is shared shifts).
--
-- 1. Site warnings. An accident report says what was changed; the cleaner
--    who goes to that building next week never sees it. A loose stair rod
--    or a step with no rail is still there for them. So the office can turn
--    a report into a warning on the site ("Loose stair rod on the top
--    landing - use the other stairs"), and every staff member's job page at
--    that site shows it until the office marks it fixed.
--
--    Written by the office in its own words, never copied from the report,
--    so no injury details (health data) reach the cleaners who read it.
--    created_by and resolved_by are plain uuids: this table has no FK to
--    profiles, on purpose (0094/0095).
--
-- 2. Reminders. Nothing reminded anyone about an HSE deadline or a report
--    left open. The daily cron (and the office dashboard, like the other
--    sweeps) now rings the bell for admins. This table records which
--    reminders went, so each is sent once. Only the server (service role)
--    writes it.

create table if not exists site_hazards (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  hazard text not null check (length(trim(hazard)) > 0),
  incident_id uuid references incident_reports(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

create index if not exists site_hazards_property_open_idx on site_hazards (property_id) where resolved_at is null;

alter table site_hazards enable row level security;

drop policy if exists "site_hazards: admin all" on site_hazards;
create policy "site_hazards: admin all" on site_hazards
  for all using (is_admin()) with check (is_admin());

-- Anyone who can be sent to a job sees the warnings still in force.
-- Clients do not: a warning is for the people doing the work.
drop policy if exists "site_hazards: staff read open" on site_hazards;
create policy "site_hazards: staff read open" on site_hazards
  for select using (
    resolved_at is null
    and is_active_cleaner()
    and exists (
      select 1 from profiles
      where id = auth.uid() and role in ('cleaner', 'inventory', 'supervisor', 'admin')
    )
  );

create table if not exists incident_reminders_sent (
  report_id uuid not null references incident_reports(id) on delete cascade,
  reminder_key text not null,
  sent_at timestamptz not null default now(),
  primary key (report_id, reminder_key)
);

-- No policies: RLS on with none means only the service role can touch it.
alter table incident_reminders_sent enable row level security;
