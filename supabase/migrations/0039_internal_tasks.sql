-- Internal task/workflow board: lets admins and supervisors assign work
-- to each other (office admin, not cleaning jobs - those already have
-- their own tasks table scoped to a job). Same audience as the rest of
-- the operational admin portal, so it reuses is_admin_or_supervisor()
-- from 0035 rather than introducing a new access tier.
create table internal_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  assigned_to uuid references profiles(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  status text not null default 'to_do' check (status in ('to_do', 'in_progress', 'done')),
  due_date date,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table internal_tasks enable row level security;

create policy "internal_tasks: admin or supervisor all" on internal_tasks
  for all using (is_admin_or_supervisor());
