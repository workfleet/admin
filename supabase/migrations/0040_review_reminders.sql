-- Review reminders: a due date (+ optional notes) attached to either a
-- client (periodic account review) or a staff member (yearly 1:1s), that
-- surfaces on the Dashboard once due rather than sitting quietly on the
-- client/staff page waiting to be remembered. One table for both, since
-- they're the same shape - which one it's for is just whichever of
-- client_id/staff_id is set.
create table reminders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  staff_id uuid references profiles(id) on delete cascade,
  due_date date not null,
  recurs_yearly boolean not null default false,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((client_id is not null and staff_id is null) or (client_id is null and staff_id is not null))
);

alter table reminders enable row level security;

create policy "reminders: admin or supervisor all" on reminders for all using (is_admin_or_supervisor());
