-- Lets staff request holiday or flag themselves unavailable for a date
-- range, and admin approve/decline with an optional note. Separate from
-- staff_requests (kit top-up/issue) since this needs a date range and a
-- three-way outcome (pending/approved/declined) rather than open/resolved.
create table time_off_requests (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid references profiles(id) on delete cascade not null,
  type text not null check (type in ('holiday', 'unavailable')),
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  admin_note text,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

alter table time_off_requests enable row level security;

create policy "time_off_requests: cleaner insert own" on time_off_requests
  for insert with check (cleaner_id = auth.uid() and is_active_cleaner());

create policy "time_off_requests: cleaner select own" on time_off_requests
  for select using (cleaner_id = auth.uid());

create policy "time_off_requests: admin all" on time_off_requests
  for all using (is_admin());

create index time_off_requests_cleaner_id_idx on time_off_requests(cleaner_id, start_date);
