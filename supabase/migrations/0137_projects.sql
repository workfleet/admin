-- Projects (follows 0136).
--
-- Somewhere for work that has a goal and a deadline rather than a weekly
-- rota slot: a tender, starting a new contract, a deep clean, getting ISO
-- certified, an internal job. A project holds its own tasks, key dates,
-- notes and files, and can be linked to a client and one of its sites so it
-- shows on that client's page.
--
-- Office only (admins and supervisors), like Team tasks. Cleaners see
-- nothing here yet.
--
-- owner_id, assigned_to, created_by and uploaded_by are plain uuids with no
-- FK to profiles, on purpose (0094/0095 - a second path to profiles breaks
-- every bare embed of it). The page looks names up itself.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'other'
    check (kind in ('tender', 'contract_start', 'deep_clean', 'certification', 'internal', 'other')),
  status text not null default 'active'
    check (status in ('planning', 'active', 'on_hold', 'done', 'cancelled')),
  description text,
  client_id uuid references clients(id) on delete set null,
  property_id uuid references properties(id) on delete set null,
  owner_id uuid,
  start_date date,
  due_date date,
  -- Tenders: how it ended. Null until decided.
  outcome text check (outcome in ('won', 'lost', 'withdrawn')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists projects_client_idx on projects (client_id);
create index if not exists projects_status_idx on projects (status);

create table if not exists project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  notes text,
  assigned_to uuid,
  due_date date,
  status text not null default 'to_do' check (status in ('to_do', 'in_progress', 'done')),
  position integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists project_tasks_project_idx on project_tasks (project_id, position);

-- Deadlines that matter on their own: "questions close", "submit by",
-- "contract starts".
create table if not exists project_dates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  date date not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists project_dates_project_idx on project_dates (project_id, date);

-- Notes the office writes, plus one-line events the page records itself
-- ("Task done: ..."), so the project keeps a history.
create table if not exists project_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note', 'event')),
  body text not null check (length(trim(body)) > 0),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists project_notes_project_idx on project_notes (project_id, created_at desc);

create table if not exists project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  file_size integer,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists project_files_project_idx on project_files (project_id);

alter table projects enable row level security;
alter table project_tasks enable row level security;
alter table project_dates enable row level security;
alter table project_notes enable row level security;
alter table project_files enable row level security;

drop policy if exists "projects: office all" on projects;
create policy "projects: office all" on projects
  for all using (is_admin_or_supervisor()) with check (is_admin_or_supervisor());

drop policy if exists "project_tasks: office all" on project_tasks;
create policy "project_tasks: office all" on project_tasks
  for all using (is_admin_or_supervisor()) with check (is_admin_or_supervisor());

drop policy if exists "project_dates: office all" on project_dates;
create policy "project_dates: office all" on project_dates
  for all using (is_admin_or_supervisor()) with check (is_admin_or_supervisor());

drop policy if exists "project_notes: office all" on project_notes;
create policy "project_notes: office all" on project_notes
  for all using (is_admin_or_supervisor()) with check (is_admin_or_supervisor());

drop policy if exists "project_files: office all" on project_files;
create policy "project_files: office all" on project_files
  for all using (is_admin_or_supervisor()) with check (is_admin_or_supervisor());

-- Keep updated_at honest for the list's "last touched" order.
create or replace function projects_touch_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists projects_touch_updated_at on projects;
create trigger projects_touch_updated_at
  before update on projects
  for each row execute function projects_touch_updated_at();

-- Private bucket for project files. Office only - nothing in it is for staff.
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

drop policy if exists "project-files: office manage" on storage.objects;
create policy "project-files: office manage" on storage.objects
  for all to authenticated
  using (bucket_id = 'project-files' and is_admin_or_supervisor())
  with check (bucket_id = 'project-files' and is_admin_or_supervisor());
