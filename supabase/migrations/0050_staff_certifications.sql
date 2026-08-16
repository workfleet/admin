-- Compliance/certification expiry tracking (DBS checks, insurance,
-- training certs) - matters for winning commercial contracts that
-- require vetted staff. Deliberately just dates/notes, not files -
-- company_documents (0048) already covers document storage if a copy
-- needs attaching later.
create table staff_certifications (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid references profiles(id) on delete cascade not null,
  name text not null,
  expiry_date date,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index staff_certifications_staff_id_idx on staff_certifications(staff_id);

alter table staff_certifications enable row level security;

create policy "staff_certifications: admin or supervisor manage" on staff_certifications
  for all using (is_admin_or_supervisor());

create policy "staff_certifications: self select" on staff_certifications
  for select using (staff_id = auth.uid());
