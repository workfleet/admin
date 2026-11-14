-- AI assistant drafts (follows 0138).
--
-- /admin/assistant lets the office ask for a draft of any document - a
-- client letter, a policy, a job advert, a tender answer. Each draft is
-- kept here so it can be reopened and downloaded again, and so there is a
-- record of where AI was used (some tenders ask you to declare it).
--
-- Written by /api/ai/draft with the service key; the office reads and
-- deletes. created_by is a plain uuid with no FK to profiles, on purpose
-- (0094/0095).

create table if not exists ai_drafts (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null,
  title text not null,
  request text,
  draft text not null,
  placeholders jsonb not null default '[]'::jsonb,
  client_id uuid references clients(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  -- The draft this one revised, when someone asked for a change.
  revised_from uuid references ai_drafts(id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists ai_drafts_created_idx on ai_drafts (created_at desc);
create index if not exists ai_drafts_client_idx on ai_drafts (client_id);

alter table ai_drafts enable row level security;

drop policy if exists "ai_drafts: office read" on ai_drafts;
create policy "ai_drafts: office read" on ai_drafts
  for select using (is_admin_or_supervisor());

drop policy if exists "ai_drafts: office delete" on ai_drafts;
create policy "ai_drafts: office delete" on ai_drafts
  for delete using (is_admin_or_supervisor());
