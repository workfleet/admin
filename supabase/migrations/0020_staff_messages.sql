-- Two-way message thread between a cleaner and admin, for general
-- communication (schedule questions, quick check-ins) separate from the
-- structured kit top-up/issue request flow in staff_requests.
create table staff_messages (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid references profiles(id) on delete cascade not null,
  sender text not null check (sender in ('cleaner', 'admin')),
  sender_profile_id uuid references profiles(id) on delete set null,
  body text not null,
  read_by_admin boolean not null default false,
  read_by_cleaner boolean not null default false,
  created_at timestamptz not null default now()
);

alter table staff_messages enable row level security;

create policy "staff_messages: admin all" on staff_messages
  for all using (is_admin());

create policy "staff_messages: cleaner select own" on staff_messages
  for select using (cleaner_id = auth.uid());

create policy "staff_messages: cleaner insert own" on staff_messages
  for insert with check (cleaner_id = auth.uid() and is_active_cleaner());

create policy "staff_messages: cleaner update own read state" on staff_messages
  for update using (cleaner_id = auth.uid());

create index staff_messages_cleaner_id_idx on staff_messages(cleaner_id, created_at);
