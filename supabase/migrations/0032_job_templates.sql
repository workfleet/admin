-- Reusable checklists (e.g. "Pub", "Office", "End of Tenancy") that admin
-- can apply to a job instead of retyping the same to-do list every time.
-- Applying a template always appends to whatever tasks a job already has
-- rather than replacing them, so it's never destructive.
create table job_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table job_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references job_templates(id) on delete cascade not null,
  description text not null,
  sort_order integer not null default 0
);

create index job_template_items_template_id_idx on job_template_items(template_id, sort_order);

alter table job_templates enable row level security;
alter table job_template_items enable row level security;

create policy "job_templates: admin all" on job_templates
  for all using (is_admin());

create policy "job_template_items: admin all" on job_template_items
  for all using (is_admin());
