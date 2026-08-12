-- Replaces the single admin<->cleaner staff_messages thread (0020, not yet
-- applied anywhere) with a proper multi-conversation chat: one shared
-- "Team Chat" group everyone lands in automatically, plus the ability for
-- any two staff members (admin or cleaner) to start a private 1:1 - like
-- WhatsApp rather than a single admin inbox.
drop table if exists staff_messages;

-- "profiles: self or admin" (schema.sql) means a cleaner can only ever
-- see their own profile row - fine everywhere else, but it silently
-- breaks a staff directory and sender-name lookups for chat, since a
-- cleaner can't resolve who anyone else even is. Widen visibility to
-- "any staff member can see any other staff member", not just admin.
create or replace function is_staff() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'cleaner')
  );
$$ language sql security definer stable;

create policy "profiles: staff directory visible to staff" on profiles
  for select using (role in ('admin', 'cleaner') and is_staff());

create table conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('group', 'direct')),
  name text,
  created_at timestamptz not null default now()
);

create table conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  profile_id uuid references profiles(id) on delete cascade not null,
  last_read_at timestamptz not null default now(),
  unique (conversation_id, profile_id)
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  sender_id uuid references profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index conversation_participants_profile_id_idx on conversation_participants(profile_id);
create index chat_messages_conversation_id_idx on chat_messages(conversation_id, created_at);

alter table conversations enable row level security;
alter table conversation_participants enable row level security;
alter table chat_messages enable row level security;

-- Helper: is the current user a participant in this conversation? Used by
-- every policy below, and marked security definer so it can read
-- conversation_participants without recursing back into its own RLS.
create or replace function is_conversation_participant(conv_id uuid) returns boolean as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = conv_id and profile_id = auth.uid()
  );
$$ language sql security definer stable;

create policy "conversations: participant or admin select" on conversations
  for select using (is_conversation_participant(id) or is_admin());
create policy "conversations: admin insert" on conversations
  for insert with check (is_admin());

create policy "conversation_participants: participant or admin select" on conversation_participants
  for select using (is_conversation_participant(conversation_id) or is_admin());
create policy "conversation_participants: admin insert" on conversation_participants
  for insert with check (is_admin());
create policy "conversation_participants: self update read state" on conversation_participants
  for update using (profile_id = auth.uid());

create policy "chat_messages: participant or admin select" on chat_messages
  for select using (is_conversation_participant(conversation_id) or is_admin());
create policy "chat_messages: participant insert own" on chat_messages
  for insert with check (sender_id = auth.uid() and is_conversation_participant(conversation_id));

-- Starting a DM has a chicken-and-egg problem under RLS (you can't insert
-- yourself as a participant because you're not a participant yet), so it
-- goes through this security-definer function instead of a direct insert.
-- Reuses an existing direct conversation between the same two people
-- rather than creating duplicates.
create or replace function create_direct_conversation(other_profile_id uuid) returns uuid as $$
declare
  conv_id uuid;
begin
  select cp1.conversation_id into conv_id
  from conversation_participants cp1
  join conversation_participants cp2 on cp1.conversation_id = cp2.conversation_id
  join conversations c on c.id = cp1.conversation_id
  where c.type = 'direct'
    and cp1.profile_id = auth.uid()
    and cp2.profile_id = other_profile_id
  limit 1;

  if conv_id is not null then
    return conv_id;
  end if;

  insert into conversations (type) values ('direct') returning id into conv_id;
  insert into conversation_participants (conversation_id, profile_id)
    values (conv_id, auth.uid()), (conv_id, other_profile_id);
  return conv_id;
end;
$$ language plpgsql security definer;

-- The one shared group chat everyone (admin + cleaners) belongs to.
insert into conversations (type, name) values ('group', 'Team Chat');

insert into conversation_participants (conversation_id, profile_id)
select (select id from conversations where type = 'group' limit 1), id
from profiles where role in ('admin', 'cleaner');

-- Auto-add newly created admin/cleaner accounts to the group chat.
create or replace function add_to_team_chat() returns trigger as $$
declare
  team_chat_id uuid;
begin
  if new.role in ('admin', 'cleaner') then
    select id into team_chat_id from conversations where type = 'group' limit 1;
    if team_chat_id is not null then
      insert into conversation_participants (conversation_id, profile_id)
      values (team_chat_id, new.id)
      on conflict (conversation_id, profile_id) do nothing;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger profiles_add_to_team_chat
  after insert on profiles
  for each row execute procedure add_to_team_chat();
