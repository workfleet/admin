-- Folders for a project's files (follows 0141).
--
-- A tender soon has thirty files - the pack, annexes, answers, pricing,
-- emails - in one flat list. Each project now keeps an ordered list of
-- folder names, and each file says which folder it is in (or none).
-- Names, not a table: folders belong to one project, have no settings of
-- their own, and renaming one is one update.
--
-- Same permissions as the rest of the project (office only, 0137).

alter table projects add column if not exists file_folders text[] not null default '{}';
alter table project_files add column if not exists folder text;

-- Starter folders for projects that already exist, by type. New projects
-- get theirs when they are created (lib/projects.js).
update projects set file_folders = case kind
  when 'tender' then array['Tender pack', 'Our submission', 'Pricing', 'Correspondence']
  when 'contract_start' then array['Site info', 'Staff & training', 'Client paperwork']
  when 'deep_clean' then array['Before photos', 'After photos', 'Paperwork']
  when 'certification' then array['Evidence', 'Policies & procedures', 'Audit reports']
  else file_folders
end
where file_folders = '{}';
