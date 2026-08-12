-- Two-way message thread between a client and admin, so clients can reach
-- out (including booking requests) through the portal instead of only by
-- phone. Admin sees every thread; a client sees only their own.
create table client_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  sender text not null check (sender in ('client', 'admin')),
  sender_profile_id uuid references profiles(id) on delete set null,
  body text not null,
  read_by_admin boolean not null default false,
  read_by_client boolean not null default false,
  created_at timestamptz not null default now()
);

alter table client_messages enable row level security;

create policy "client_messages: admin all" on client_messages
  for all using (is_admin());

create policy "client_messages: client select own" on client_messages
  for select using (client_id in (select client_id from profiles where id = auth.uid()));

create policy "client_messages: client insert own" on client_messages
  for insert with check (
    client_id in (select client_id from profiles where id = auth.uid())
    and sender = 'client'
  );

create policy "client_messages: client update own read state" on client_messages
  for update using (client_id in (select client_id from profiles where id = auth.uid()));

create index client_messages_client_id_idx on client_messages(client_id, created_at);
