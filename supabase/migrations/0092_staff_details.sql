-- The office has nowhere to keep a cleaner's phone number.
--
-- A profile row holds a name and a role. Everything else about a person -
-- phone, address, date of birth, NI number, who to ring in an emergency -
-- only exists if they came in through the onboarding form, where it sits on
-- staff_onboarding_submissions as a record of what they signed. Seventeen of
-- the eighteen staff on the live project were added directly from the
-- Cleaners page instead, so their detail page shows a name, a join date and
-- nothing else, and the phone numbers live in someone's mobile.
--
-- staff_details is the living record: one row per staff profile, edited by
-- the office from the cleaner's page and by the person themself from My
-- Profile. The onboarding submission stays as it is - it is what was signed
-- on the day and should not drift - and seeds this table on the way in.
--
-- Read by admins and by the person the row is about. Supervisors are kept
-- out, as they are from the rest of the staff record (see the gate on
-- app/admin/cleaners/[id]).

create table staff_details (
  profile_id uuid primary key references profiles(id) on delete cascade,
  phone text,
  address text,
  date_of_birth date,
  ni_number text,
  emergency_contact_name text,
  emergency_contact_phone text,
  start_date date,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

alter table staff_details enable row level security;

create policy "staff_details: admin all" on staff_details
  for all using (is_admin()) with check (is_admin());

-- A person keeps their own row current. They cannot see or touch anyone
-- else's, and profile_id is pinned to them on the way in and on update.
create policy "staff_details: self select" on staff_details
  for select using (profile_id = auth.uid());
create policy "staff_details: self insert" on staff_details
  for insert with check (profile_id = auth.uid());
create policy "staff_details: self update" on staff_details
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Anyone who did onboard through the form already told us all of this once.
-- start_date is left for the office to set; the day the contract was signed
-- is not necessarily the day they started.
insert into staff_details (profile_id, phone, address, date_of_birth, ni_number, emergency_contact_name, emergency_contact_phone)
select s.profile_id, s.phone, s.address, s.date_of_birth, s.ni_number, s.emergency_contact_name, s.emergency_contact_phone
from staff_onboarding_submissions s
where s.profile_id is not null
on conflict (profile_id) do nothing;
