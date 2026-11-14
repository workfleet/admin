-- AI tools on projects (follows 0137).
--
-- The project page can now ask Claude to turn a document into tasks and to
-- draft writing. Some work must not go near AI at all - a tender's terms can
-- forbid it, or require AI use to be declared - so each project carries its
-- own switch, and /api/projects/ai refuses when it is off.
--
-- Existing tenders start with it OFF: the Bus Station tender restricts AI
-- use, and that decision belongs to whoever runs the bid. Everything else
-- starts on. Every AI use is also written to the project's history
-- (project_notes, kind 'event'), so it can be declared if asked.

alter table projects add column if not exists ai_enabled boolean not null default true;

update projects set ai_enabled = false where kind = 'tender';

-- New tenders start with it off too; someone has to switch it on on purpose.
create or replace function projects_tender_ai_off() returns trigger as $$
begin
  if new.kind = 'tender' then
    new.ai_enabled := false;
  end if;
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists projects_tender_ai_off on projects;
create trigger projects_tender_ai_off
  before insert on projects
  for each row execute function projects_tender_ai_off();
