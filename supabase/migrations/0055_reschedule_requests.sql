-- Client-initiated reschedule requests - request only, admin approves,
-- same "request then admin decides" shape as time_off_requests rather
-- than letting the client change the rota directly.
create table reschedule_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null,
  client_id uuid references clients(id) on delete cascade not null,
  requested_scheduled_at timestamptz not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  admin_note text,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index reschedule_requests_job_id_idx on reschedule_requests(job_id);

alter table reschedule_requests enable row level security;

create policy "reschedule_requests: client insert own" on reschedule_requests
  for insert with check (
    client_id in (select client_id from profiles where id = auth.uid())
    and exists (
      select 1 from jobs j join properties p on p.id = j.property_id
      where j.id = job_id and p.client_id = reschedule_requests.client_id
    )
  );

create policy "reschedule_requests: client select own" on reschedule_requests
  for select using (client_id in (select client_id from profiles where id = auth.uid()));

create policy "reschedule_requests: admin or supervisor manage" on reschedule_requests
  for all using (is_admin_or_supervisor());

-- Same pattern as notify_admins_on_time_extension_request (0033) -
-- admin should hear about a reschedule ask promptly, before the
-- originally-booked slot passes.
create or replace function notify_admins_on_reschedule_request() returns trigger as $$
declare
  client_name text;
  job_address text;
begin
  select name into client_name from clients where id = new.client_id;
  select p.address into job_address from jobs j join properties p on p.id = j.property_id where j.id = new.job_id;

  insert into notifications (user_id, message)
  select id, coalesce(client_name, 'A client') || ' requested to reschedule ' || coalesce(job_address, 'a job') || ' to ' || to_char(new.requested_scheduled_at, 'DD Mon HH24:MI')
  from profiles where role = 'admin';

  return new;
end;
$$ language plpgsql security definer;

create trigger on_reschedule_requested
  after insert on reschedule_requests
  for each row execute procedure notify_admins_on_reschedule_request();
