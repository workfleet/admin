-- Extends the existing staff document library (0048/0049) to also
-- support client-facing documents (e.g. health & safety docs for a
-- specific site) rather than building a parallel system. A document
-- with client_id set belongs to that client's portal only - it's
-- deliberately excluded from the staff-facing list (client_id is null)
-- so admin's own Documents page doesn't get cluttered with docs meant
-- for one client's eyes, and a document only ever has one audience
-- (staff-targeted OR one client), never both.
alter table company_documents add column client_id uuid references clients(id) on delete cascade;
alter table company_documents drop constraint company_documents_category_check;
alter table company_documents add constraint company_documents_category_check
  check (category in ('policy', 'contract', 'health_safety', 'other'));

drop policy if exists "company_documents: staff select" on company_documents;
create policy "company_documents: staff select" on company_documents
  for select using (is_staff() and client_id is null and document_visible_to_caller(id));

create policy "company_documents: client select own" on company_documents
  for select using (client_id is not null and client_id in (select client_id from profiles where id = auth.uid()));

drop policy if exists "company-documents: staff read" on storage.objects;
create policy "company-documents: staff read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-documents'
    and is_staff()
    and exists (
      select 1 from company_documents cd
      where cd.storage_path = name and cd.client_id is null and document_visible_to_caller(cd.id)
    )
  );

create policy "company-documents: client read own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-documents'
    and exists (
      select 1 from company_documents cd
      where cd.storage_path = name
        and cd.client_id is not null
        and cd.client_id in (select client_id from profiles where id = auth.uid())
    )
  );
