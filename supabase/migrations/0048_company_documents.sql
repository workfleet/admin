-- Shared document library (policies, contracts, etc.) admin uploads once
-- and every staff member can browse/download - separate from the
-- free-text POLICY_SECTIONS content and from per-cleaner onboarding
-- documents (ID photos), which are individual rather than shared.
insert into storage.buckets (id, name, public) values ('company-documents', 'company-documents', false);

create table company_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other' check (category in ('policy', 'contract', 'other')),
  storage_path text not null,
  file_name text not null,
  file_size integer,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table company_documents enable row level security;

-- Any staff member (cleaner/supervisor/admin) can see what's in the
-- library; only admin/supervisor can add, rename, or remove documents.
create policy "company_documents: staff select" on company_documents
  for select using (is_staff());

create policy "company_documents: admin or supervisor manage" on company_documents
  for all using (is_admin_or_supervisor());

create policy "company-documents: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'company-documents' and is_staff());

create policy "company-documents: admin or supervisor manage" on storage.objects
  for all to authenticated
  using (bucket_id = 'company-documents' and is_admin_or_supervisor())
  with check (bucket_id = 'company-documents' and is_admin_or_supervisor());
