-- Simple heartbeat-based presence ("who's online", like Teams' green dot).
-- Supabase Realtime Presence was tried first, but this project's Realtime
-- Authorization setup requires RLS policies on the system realtime.messages
-- table whose exact required shape couldn't be verified without live
-- access to confirm - guessing that blind risked another silent failure.
-- A heartbeat row per user, refreshed every ~20s while the app is open and
-- read by admin/supervisor, is a well-understood pattern that fits the
-- rest of this app (plain table + RLS), even though it's "recently seen"
-- rather than truly instant.
create table user_presence (
  profile_id uuid primary key references profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table user_presence enable row level security;

-- Only admin/supervisor can see who's online - matches the "who's online"
-- panel being admin/supervisor-only in the UI, enforced here too.
create policy "user_presence: admin or supervisor select" on user_presence
  for select using (is_admin_or_supervisor());

-- Anyone signed in can report their own heartbeat, regardless of role -
-- cleaners get tracked even though they can't see the panel themselves.
create policy "user_presence: self upsert" on user_presence
  for insert with check (profile_id = auth.uid());
create policy "user_presence: self update" on user_presence
  for update using (profile_id = auth.uid());
