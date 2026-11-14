-- Company facts for the AI assistant (follows 0139).
--
-- The assistant only writes what it has been told. Without facts about
-- the company, every draft was full of [ADD: insurance cover] blanks and
-- tender answers could drift apart. This is one page of answers - what we
-- do, what cover we hold, how quality is checked, who signs letters - that
-- every draft reads, plus a list of things it must never claim.
--
-- Office staff read them (the assistant runs as them); only admins change
-- them, because anything here ends up in letters and bids as fact.
-- updated_by is a plain uuid, no FK to profiles (0094/0095).

create table if not exists company_facts (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table company_facts enable row level security;

drop policy if exists "company_facts: office read" on company_facts;
create policy "company_facts: office read" on company_facts
  for select using (is_admin_or_supervisor());

drop policy if exists "company_facts: admin write" on company_facts;
create policy "company_facts: admin write" on company_facts
  for all using (is_admin()) with check (is_admin());

-- Confirmed by Jess on 2026-11-06 for the Bus Station tender: the company
-- holds neither ISO certificate. Kept only if nothing is there yet.
insert into company_facts (key, value)
values ('never_claim', 'ISO 9001 or ISO 14001 certification - we do not hold either. Only say we are working towards them.')
on conflict (key) do nothing;

-- Drafts can now be edited and their blanks filled in on the page, then
-- saved back.
drop policy if exists "ai_drafts: office update" on ai_drafts;
create policy "ai_drafts: office update" on ai_drafts
  for update using (is_admin_or_supervisor()) with check (is_admin_or_supervisor());
