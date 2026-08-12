-- Lets a cleaner ask for more time on a job they're currently on (e.g.
-- admin allocated 2 hours but the property needs longer), and admin
-- either approve it (which extends the job's duration_minutes directly),
-- decline it, or propose a different time/duration instead. Separate
-- from staff_requests (kit top-up/issue) for the same reason
-- time_off_requests is: this needs a three-way outcome plus structured
-- fields (requested minutes, an optional suggested alternative slot)
-- rather than a free-text description.
create table time_extension_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade not null,
  cleaner_id uuid references profiles(id) on delete cascade not null,
  requested_minutes integer not null check (requested_minutes > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'alternative_suggested')),
  admin_note text,
  suggested_scheduled_at timestamptz,
  suggested_duration_minutes integer,
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index time_extension_requests_job_id_idx on time_extension_requests(job_id);
create index time_extension_requests_cleaner_id_idx on time_extension_requests(cleaner_id, created_at);

alter table time_extension_requests enable row level security;

create policy "time_extension_requests: cleaner insert own" on time_extension_requests
  for insert with check (cleaner_id = auth.uid() and is_active_cleaner() and is_assigned_to_job(job_id));

create policy "time_extension_requests: cleaner select own" on time_extension_requests
  for select using (cleaner_id = auth.uid());

create policy "time_extension_requests: admin all" on time_extension_requests
  for all using (is_admin());

-- Same pattern as notify_admins_on_kit_request (0016): every admin gets
-- an in-app notification the moment a request comes in, since a cleaner
-- waiting on-site for an answer is time-sensitive.
create or replace function notify_admins_on_time_extension_request() returns trigger as $$
declare
  requester_name text;
  job_address text;
begin
  select full_name into requester_name from profiles where id = new.cleaner_id;
  select p.address into job_address from jobs j join properties p on p.id = j.property_id where j.id = new.job_id;

  insert into notifications (user_id, message)
  select id, coalesce(requester_name, 'A cleaner') || ' requested ' || new.requested_minutes || ' more minutes at ' || coalesce(job_address, 'a job')
  from profiles where role = 'admin';

  return new;
end;
$$ language plpgsql security definer;

create trigger on_time_extension_requested
  after insert on time_extension_requests
  for each row execute procedure notify_admins_on_time_extension_request();

-- Notifies the cleaner in-app the moment admin decides, same pattern as
-- notify_cleaner_on_time_off_decided (0025).
create or replace function notify_cleaner_on_time_extension_decided() returns trigger as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'declined', 'alternative_suggested') then
    insert into notifications (user_id, message)
    values (
      new.cleaner_id,
      case
        when new.status = 'approved' then 'Your request for ' || new.requested_minutes || ' more minutes was approved.'
        when new.status = 'declined' then 'Your request for ' || new.requested_minutes || ' more minutes was declined.'
        else 'Admin suggested a different time for your job - check the job for details.'
      end
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger time_extension_requests_notify_cleaner
  after update on time_extension_requests
  for each row execute procedure notify_cleaner_on_time_extension_decided();
