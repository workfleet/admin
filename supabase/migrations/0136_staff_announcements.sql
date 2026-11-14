-- Office announcements to all staff (follows 0135).
--
-- The office had no way to tell every cleaner something at once except the
-- team chat, which scrolls away and which nobody has to open. An
-- announcement is written once on /admin/announcements and pops up over
-- the cleaner app the next time each person opens it, until they tap
-- "Got it". The office sees who has and hasn't seen it.
--
-- Optionally it also rings everyone's bell, which the push sweep in
-- /api/notify turns into a phone notification for anyone with alerts on.
--
-- created_by and profile_id are plain uuids: neither table has an FK to
-- profiles, on purpose (0094/0095 - a second path to profiles breaks every
-- bare embed of it).

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  body text not null default '',
  ring_bell boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  -- Set when the office stops showing it. Anyone who hasn't opened the app
  -- by then won't be shown it.
  archived_at timestamptz
);

create index if not exists announcements_live_idx on announcements (created_at) where archived_at is null;

create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  profile_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

create index if not exists announcement_reads_profile_idx on announcement_reads (profile_id);

alter table announcements enable row level security;
alter table announcement_reads enable row level security;

-- The office writes and manages them.
drop policy if exists "announcements: office all" on announcements;
create policy "announcements: office all" on announcements
  for all using (is_admin_or_supervisor()) with check (is_admin_or_supervisor());

-- Active staff read the ones still showing. Clients never see them.
drop policy if exists "announcements: staff read live" on announcements;
create policy "announcements: staff read live" on announcements
  for select using (
    archived_at is null
    and is_active_cleaner()
    and exists (
      select 1 from profiles
      where id = auth.uid() and role in ('cleaner', 'inventory')
    )
  );

-- Each person records and reads only their own "seen it".
drop policy if exists "announcement_reads: own" on announcement_reads;
create policy "announcement_reads: own" on announcement_reads
  for select using (profile_id = auth.uid());

drop policy if exists "announcement_reads: insert own" on announcement_reads;
create policy "announcement_reads: insert own" on announcement_reads
  for insert with check (profile_id = auth.uid() and is_active_cleaner());

-- The office sees everyone's, to show who hasn't seen it yet.
drop policy if exists "announcement_reads: office read" on announcement_reads;
create policy "announcement_reads: office read" on announcement_reads
  for select using (is_admin_or_supervisor());

-- Ring every active staff member's bell when one is posted with ring_bell.
-- The push sweep picks the rows up and sends them to phones.
create or replace function announcement_ring_bell() returns trigger as $$
begin
  if new.ring_bell then
    insert into notifications (user_id, message)
    select p.id, 'Message from the office: ' || new.title
    from profiles p
    where p.role in ('cleaner', 'inventory') and p.active = true;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function announcement_ring_bell() from public, anon;

drop trigger if exists announcements_ring_bell on announcements;
create trigger announcements_ring_bell
  after insert on announcements
  for each row execute function announcement_ring_bell();
