-- Client-side equivalent of staff_requests (kit top-up/issue) - a free-text
-- request a client can raise (e.g. "can you also do the windows this
-- time") that becomes a trackable open/resolved ticket for admin, rather
-- than getting lost in the open-ended client_messages thread. Kept as its
-- own table rather than widening staff_requests, since the RLS shape is
-- different (client_id, not cleaner_id) and there's no job/type structure
-- to reuse.
create table client_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
  description text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text,
  resolved_by uuid references profiles(id) on delete set null,
  resolved_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index client_requests_client_id_idx on client_requests(client_id, created_at);

alter table client_requests enable row level security;

create policy "client_requests: client insert own" on client_requests
  for insert with check (client_id in (select client_id from profiles where id = auth.uid()));

create policy "client_requests: client select own" on client_requests
  for select using (client_id in (select client_id from profiles where id = auth.uid()));

create policy "client_requests: admin or supervisor manage" on client_requests
  for all using (is_admin_or_supervisor());

-- Same pattern as notify_admins_on_kit_request (0016) / on_reschedule_requested (0055).
create or replace function notify_admins_on_client_request() returns trigger as $$
declare
  client_name text;
begin
  select name into client_name from clients where id = new.client_id;

  insert into notifications (user_id, message)
  select id, coalesce(client_name, 'A client') || ' sent a request: ' || left(new.description, 100)
  from profiles where role = 'admin';

  return new;
end;
$$ language plpgsql security definer;

create trigger on_client_request_created
  after insert on client_requests
  for each row execute procedure notify_admins_on_client_request();
