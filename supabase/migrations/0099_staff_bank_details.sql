-- Cleaners have nowhere to give the office their bank details.
--
-- Payroll needs an account holder, a sort code and an account number for
-- every person it pays, and today those arrive by text message or on a
-- scrap of paper and live in someone's phone. They belong with the rest of
-- the staff record, entered once by the person themself from My Profile
-- (or by the office on their behalf) and read only by the office when it
-- runs payroll.
--
-- They get their own table rather than three more columns on staff_details
-- (0092) so that the access to them can be narrower than "the details
-- card". staff_details is read by the Cleaners list for every current
-- member of staff to show a phone number; bank details are only ever read
-- one person at a time, on their own page, and never by that list. Same
-- shape as staff_details otherwise: one row per profile, admin all, the
-- person themself on their own row, supervisors kept out entirely.
--
-- The digits are checked on the way in - six for a sort code, eight for an
-- account number, nothing else - so a typo is refused at save rather than
-- discovered when a payment bounces. lib/bankDetails.js strips spaces and
-- dashes before sending, so "12-34-56" and "12 34 56" both store as 123456.

create table staff_bank_details (
  profile_id uuid primary key references profiles(id) on delete cascade,
  account_holder_name text not null check (length(trim(account_holder_name)) > 0),
  sort_code text not null check (sort_code ~ '^\d{6}$'),
  account_number text not null check (account_number ~ '^\d{8}$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null
);

alter table staff_bank_details enable row level security;

create policy "staff_bank_details: admin all" on staff_bank_details
  for all using (is_admin()) with check (is_admin());

-- A person can see and replace their own details. profile_id is pinned to
-- them on insert and update so the row can never be written against
-- anyone else. No self delete: the office removes a row when they leave
-- (api/admin/enforce-retention), and a person who wants theirs gone asks.
create policy "staff_bank_details: self select" on staff_bank_details
  for select using (profile_id = auth.uid());
create policy "staff_bank_details: self insert" on staff_bank_details
  for insert with check (profile_id = auth.uid());
create policy "staff_bank_details: self update" on staff_bank_details
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Every change is announced to the office. A changed bank account the day
-- before payroll is the shape payment-diversion fraud takes - a stolen
-- login, or a "please update my details" message that was not from the
-- person - so the admins hear about it in the bell whoever made the change,
-- and can ring the person to check before money moves. The admin who made
-- a change is not told about their own edit.
create or replace function notify_office_on_bank_details_changed() returns trigger as $$
declare
  subject_name text;
  actor_name text;
  actor_id uuid := auth.uid();
  message text;
begin
  select full_name into subject_name from public.profiles where id = new.profile_id;
  subject_name := coalesce(subject_name, 'A member of staff');

  if actor_id is null or actor_id = new.profile_id then
    message := subject_name
      || (case when tg_op = 'INSERT' then ' added their bank details' else ' changed their bank details' end)
      || ' - check with them before the next payroll run';
  else
    select full_name into actor_name from public.profiles where id = actor_id;
    message := 'Bank details for ' || subject_name || ' were '
      || (case when tg_op = 'INSERT' then 'added' else 'changed' end)
      || ' by ' || coalesce(actor_name, 'the office');
  end if;

  insert into public.notifications (user_id, message)
  select p.id, message
  from public.profiles p
  where p.role = 'admin'
    and (actor_id is null or p.id <> actor_id);

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists staff_bank_details_notify_office on staff_bank_details;
create trigger staff_bank_details_notify_office
  after insert or update on staff_bank_details
  for each row execute procedure notify_office_on_bank_details_changed();
