-- Panic button for lone workers: a cleaner on-site alone can raise an
-- immediate alert to every admin/supervisor, independent of whatever
-- job or request flow they're in. Its own table rather than folding
-- into staff_requests - this needs to be surfaced far faster than a
-- routine kit request, so the admin side shows a persistent banner on
-- every page (not just buried in a Requests tab) until acknowledged.
create table emergency_alerts (
  id uuid primary key default gen_random_uuid(),
  cleaner_id uuid references profiles(id) on delete cascade not null,
  job_id uuid references jobs(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'acknowledged')),
  acknowledged_by uuid references profiles(id) on delete set null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index emergency_alerts_status_idx on emergency_alerts(status, created_at);

alter table emergency_alerts enable row level security;

create policy "emergency_alerts: cleaner insert own" on emergency_alerts
  for insert with check (cleaner_id = auth.uid() and is_active_cleaner());

create policy "emergency_alerts: cleaner select own" on emergency_alerts
  for select using (cleaner_id = auth.uid());

create policy "emergency_alerts: admin or supervisor manage" on emergency_alerts
  for all using (is_admin_or_supervisor());

-- Unlike other notify_admins_on_* triggers (pause/reschedule/time-off,
-- which only ping role = 'admin'), this one also pings supervisors -
-- for a lone-worker alert, reaching whoever's actually online first
-- matters more than following the usual admin-only escalation path.
create or replace function notify_admins_on_emergency_alert() returns trigger as $$
declare
  cleaner_name text;
begin
  select full_name into cleaner_name from profiles where id = new.cleaner_id;

  insert into notifications (user_id, message)
  select id, '🚨 EMERGENCY ALERT from ' || coalesce(cleaner_name, 'a cleaner') || ' - acknowledge and call them now.'
  from profiles where role in ('admin', 'supervisor');

  return new;
end;
$$ language plpgsql security definer;

create trigger on_emergency_alert_raised
  after insert on emergency_alerts
  for each row execute procedure notify_admins_on_emergency_alert();
