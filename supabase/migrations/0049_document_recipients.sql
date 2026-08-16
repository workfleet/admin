-- Lets admin target a document at specific cleaners instead of always
-- sharing with everyone. No rows for a document = visible to all staff
-- (existing behaviour preserved); rows present = visible only to those
-- listed. security definer so a cleaner's own RLS on this table doesn't
-- need a separate permissive select policy, same pattern as
-- is_assigned_to_job (0030).
create table company_document_recipients (
  document_id uuid references company_documents(id) on delete cascade not null,
  profile_id uuid references profiles(id) on delete cascade not null,
  primary key (document_id, profile_id)
);

alter table company_document_recipients enable row level security;

create policy "company_document_recipients: admin or supervisor manage" on company_document_recipients
  for all using (is_admin_or_supervisor());

create or replace function document_visible_to_caller(target_document_id uuid) returns boolean as $$
  select
    not exists (select 1 from company_document_recipients where document_id = target_document_id)
    or exists (select 1 from company_document_recipients where document_id = target_document_id and profile_id = auth.uid())
$$ language sql security definer stable;

drop policy if exists "company_documents: staff select" on company_documents;
create policy "company_documents: staff select" on company_documents
  for select using (is_staff() and document_visible_to_caller(id));

-- Storage-level enforcement too, not just the UI/list query - createSignedUrl
-- still goes through this policy, so a targeted document's file can't be
-- fetched by a cleaner who isn't a listed recipient even if they somehow
-- had the storage path.
drop policy if exists "company-documents: staff read" on storage.objects;
create policy "company-documents: staff read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-documents'
    and is_staff()
    and exists (
      select 1 from company_documents cd
      where cd.storage_path = name and document_visible_to_caller(cd.id)
    )
  );
