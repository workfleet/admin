-- Lets a client ask to pause all cleans over a date range (holiday,
-- building work) without cancelling the whole arrangement - same
-- "request then admin decides" shape as reschedule_requests (0055)
-- and time_off_requests, rather than the client changing anything
-- directly. Approving this doesn't auto-touch the rota - admin still
-- adjusts affected jobs manually, same as any other schedule change.
create table client_pause_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade not null,
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

create index client_pause_requests_client_id_idx on client_pause_requests(client_id, created_at);

alter table client_pause_requests enable row level security;

create policy "client_pause_requests: client insert own" on client_pause_requests
  for insert with check (client_id in (select client_id from profiles where id = auth.uid()));

create policy "client_pause_requests: client select own" on client_pause_requests
  for select using (client_id in (select client_id from profiles where id = auth.uid()));

create policy "client_pause_requests: admin or supervisor manage" on client_pause_requests
  for all using (is_admin_or_supervisor());

create or replace function notify_admins_on_pause_request() returns trigger as $$
declare
  client_name text;
begin
  select name into client_name from clients where id = new.client_id;

  insert into notifications (user_id, message)
  select id, coalesce(client_name, 'A client') || ' requested to pause cleans from ' || to_char(new.start_date, 'DD Mon') || ' to ' || to_char(new.end_date, 'DD Mon')
  from profiles where role = 'admin';

  return new;
end;
$$ language plpgsql security definer;

create trigger on_pause_requested
  after insert on client_pause_requests
  for each row execute procedure notify_admins_on_pause_request();
