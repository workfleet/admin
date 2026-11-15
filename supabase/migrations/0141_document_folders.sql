-- Folders for the Documents library (follows 0140).
--
-- The library had three fixed groups - Policy, Contract, Other - so RAMS,
-- safety data sheets, toolbox talks and insurance all ended up under
-- "Policy" or "Other". The office can now make its own folders, upload
-- into one, and move documents between them.
--
-- Each folder carries a category, and a document moved into a folder takes
-- that folder's category. That keeps the one rule that depends on category
-- working: signed worker contracts ("contract") are admin-only in the AI
-- chat. Who can see a document (everyone, or chosen cleaners - 0049) does
-- not change.
--
-- Client documents (client_id set, shown on the client's page) are not
-- part of the library and get no folder.

create table if not exists document_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  category text not null default 'other' check (category in ('policy', 'contract', 'health_safety', 'other')),
  position integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists document_folders_name_idx on document_folders (lower(trim(name)));

alter table document_folders enable row level security;

-- Staff browse the library by folder; the office manages folders.
drop policy if exists "document_folders: staff read" on document_folders;
create policy "document_folders: staff read" on document_folders
  for select using (is_staff());

drop policy if exists "document_folders: office manage" on document_folders;
create policy "document_folders: office manage" on document_folders
  for all using (is_admin_or_supervisor()) with check (is_admin_or_supervisor());

insert into document_folders (name, category, position) values
  ('Policies', 'policy', 10),
  ('Insurance', 'other', 20),
  ('Certificates & accreditations', 'other', 30),
  ('RAMS', 'policy', 40),
  ('COSHH & safety data sheets', 'policy', 50),
  ('Training', 'policy', 60),
  ('Contracts', 'contract', 70),
  ('Other', 'other', 80)
on conflict do nothing;

alter table company_documents add column if not exists folder_id uuid references document_folders(id) on delete set null;
create index if not exists company_documents_folder_idx on company_documents (folder_id);

-- Everything already in the library goes to the folder matching its old
-- group. The AI tidy-up on the Documents page then suggests better homes.
update company_documents d
set folder_id = f.id
from document_folders f
where d.client_id is null
  and d.folder_id is null
  and f.name = case d.category when 'contract' then 'Contracts' when 'policy' then 'Policies' else 'Other' end;

-- New library documents with no folder chosen (onboarding files a signed
-- contract this way) land in the first folder for their category, and a
-- document's category follows the folder it is put in.
create or replace function company_documents_folder() returns trigger as $$
begin
  if new.client_id is not null then
    new.folder_id := null;
    return new;
  end if;
  if new.folder_id is null then
    select id into new.folder_id from document_folders
    where category = new.category order by position, created_at limit 1;
  else
    select category into new.category from document_folders where id = new.folder_id;
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists company_documents_folder on company_documents;
create trigger company_documents_folder
  before insert or update of folder_id on company_documents
  for each row execute function company_documents_folder();
