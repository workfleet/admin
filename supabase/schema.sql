-- ============================================================
-- CLEANING CRM SCHEMA
-- Run this in Supabase: Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1. PROFILES (extends Supabase auth.users with a role)
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  role text not null default 'cleaner' check (role in ('admin', 'cleaner', 'client')),
  client_id uuid, -- only used if role = 'client', links them to their client record
  created_at timestamptz default now()
);

-- 2. CLIENTS (the businesses/customers you clean for)
create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- 3. PROPERTIES (a client can have multiple sites/addresses)
create table properties (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  address text not null,
  notes text,
  created_at timestamptz default now()
);

-- 4. JOBS (a scheduled clean at a property)
create table jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade,
  cleaner_id uuid references profiles(id),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'missed')),
  created_at timestamptz default now()
);

-- 5. TASKS (the to-do list for a job)
create table tasks (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  description text not null,
  completed boolean default false,
  completed_at timestamptz
);

-- 6. CHECKINS (cleaner arriving/leaving a job)
create table checkins (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  cleaner_id uuid references profiles(id),
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  lat double precision,
  lng double precision
);

-- 7. PHOTOS (uploaded during a job)
create table photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references jobs(id) on delete cascade,
  uploaded_by uuid references profiles(id),
  url text not null,
  caption text,
  created_at timestamptz default now()
);

-- 8. NOTIFICATIONS (in-app notification feed)
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  message text not null,
  read boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table clients enable row level security;
alter table properties enable row level security;
alter table jobs enable row level security;
alter table tasks enable row level security;
alter table checkins enable row level security;
alter table photos enable row level security;
alter table notifications enable row level security;

-- Helper: is the current user an admin?
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer;

-- PROFILES: users can see their own profile; admins see all
create policy "profiles: self or admin" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "profiles: self update" on profiles
  for update using (id = auth.uid());

-- CLIENTS: admins manage; clients can see their own client record
create policy "clients: admin all" on clients
  for all using (is_admin());
create policy "clients: client self" on clients
  for select using (
    id in (select client_id from profiles where id = auth.uid())
  );

-- PROPERTIES: admin all; client sees their own; cleaner sees properties tied to their jobs
create policy "properties: admin all" on properties
  for all using (is_admin());
create policy "properties: client own" on properties
  for select using (
    client_id in (select client_id from profiles where id = auth.uid())
  );
create policy "properties: cleaner via job" on properties
  for select using (
    id in (select property_id from jobs where cleaner_id = auth.uid())
  );

-- JOBS: admin all; cleaner sees their own jobs; client sees jobs at their properties
create policy "jobs: admin all" on jobs
  for all using (is_admin());
create policy "jobs: cleaner own" on jobs
  for select using (cleaner_id = auth.uid());
create policy "jobs: cleaner update own" on jobs
  for update using (cleaner_id = auth.uid());
create policy "jobs: client own properties" on jobs
  for select using (
    property_id in (
      select p.id from properties p
      join profiles pr on pr.client_id = p.client_id
      where pr.id = auth.uid()
    )
  );

-- TASKS: follow the job's visibility
create policy "tasks: admin all" on tasks
  for all using (is_admin());
create policy "tasks: cleaner via job" on tasks
  for select using (job_id in (select id from jobs where cleaner_id = auth.uid()));
create policy "tasks: cleaner update via job" on tasks
  for update using (job_id in (select id from jobs where cleaner_id = auth.uid()));
create policy "tasks: client via job" on tasks
  for select using (
    job_id in (
      select j.id from jobs j
      join properties p on p.id = j.property_id
      join profiles pr on pr.client_id = p.client_id
      where pr.id = auth.uid()
    )
  );

-- CHECKINS: admin all; cleaner own; client can view via job
create policy "checkins: admin all" on checkins
  for all using (is_admin());
create policy "checkins: cleaner own" on checkins
  for all using (cleaner_id = auth.uid());
create policy "checkins: client via job" on checkins
  for select using (
    job_id in (
      select j.id from jobs j
      join properties p on p.id = j.property_id
      join profiles pr on pr.client_id = p.client_id
      where pr.id = auth.uid()
    )
  );

-- PHOTOS: admin all; cleaner can insert/view own job photos; client can view via job
create policy "photos: admin all" on photos
  for all using (is_admin());
create policy "photos: cleaner via job" on photos
  for all using (job_id in (select id from jobs where cleaner_id = auth.uid()));
create policy "photos: client via job" on photos
  for select using (
    job_id in (
      select j.id from jobs j
      join properties p on p.id = j.property_id
      join profiles pr on pr.client_id = p.client_id
      where pr.id = auth.uid()
    )
  );

-- NOTIFICATIONS: users see only their own
create policy "notifications: self" on notifications
  for select using (user_id = auth.uid());
create policy "notifications: admin insert" on notifications
  for insert with check (is_admin());
create policy "notifications: self update (mark read)" on notifications
  for update using (user_id = auth.uid());

-- ============================================================
-- TRIGGER: auto-create a profile row when someone signs up
-- ============================================================
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'cleaner');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ============================================================
-- TRIGGER: auto-notify a cleaner when they're assigned to a job
-- ============================================================
create or replace function notify_on_job_assignment() returns trigger as $$
begin
  if (new.cleaner_id is not null and (old.cleaner_id is distinct from new.cleaner_id)) then
    insert into notifications (user_id, message)
    values (
      new.cleaner_id,
      'New shift assigned: ' || to_char(new.scheduled_at, 'DD Mon YYYY HH24:MI')
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_job_cleaner_assigned
  after insert or update on jobs
  for each row execute procedure notify_on_job_assignment();

-- ============================================================
-- STORAGE: bucket for job photos (run separately if it errors,
-- storage buckets are also creatable from the dashboard UI)
-- ============================================================
insert into storage.buckets (id, name, public) values ('job-photos', 'job-photos', true)
on conflict (id) do nothing;
