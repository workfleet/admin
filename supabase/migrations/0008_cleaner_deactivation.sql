-- Lets an admin deactivate a cleaner (e.g. when they leave) without deleting
-- their historical job/task/checkin/photo records. Enforced at login (the
-- app signs a deactivated user straight back out) — see app/page.js.
alter table profiles add column if not exists active boolean not null default true;
