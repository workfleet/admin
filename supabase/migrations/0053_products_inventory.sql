-- Company-wide consumables stock levels (one running total per product,
-- not per-van) with a reorder threshold for a low-stock alert -
-- matches how supplies are actually bought today, just tracked instead
-- of ad-hoc.
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  stock_level integer not null default 0,
  reorder_threshold integer not null default 0,
  created_at timestamptz not null default now()
);

alter table products enable row level security;

create policy "products: admin or supervisor manage" on products
  for all using (is_admin_or_supervisor());

create policy "products: staff select" on products
  for select using (is_staff());
