-- Room-by-room reference checklist per property (the "digital twin") so
-- a substitute cleaner covering an absence hits the same standard the
-- regular cleaner does, rather than guessing what "done" looks like at
-- that specific property.
create table property_checklist_items (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  room text not null,
  task text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index property_checklist_items_property_id_idx on property_checklist_items(property_id);

alter table property_checklist_items enable row level security;

create policy "property_checklist_items: admin or supervisor manage" on property_checklist_items
  for all using (is_admin_or_supervisor());

create policy "property_checklist_items: staff select" on property_checklist_items
  for select using (is_staff());
