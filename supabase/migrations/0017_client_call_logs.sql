-- Audit trail of phone calls with clients: who called/was called, when,
-- what was discussed, and who at the company logged it. Admin-only, same
-- as the rest of the client management surface - clients don't see notes
-- kept about them.
create table client_call_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  logged_by uuid references profiles(id) on delete set null,
  direction text not null check (direction in ('outbound', 'inbound')),
  summary text not null,
  called_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table client_call_logs enable row level security;

create policy "client_call_logs: admin all" on client_call_logs
  for all using (is_admin());

create index client_call_logs_client_id_idx on client_call_logs(client_id, called_at desc);
