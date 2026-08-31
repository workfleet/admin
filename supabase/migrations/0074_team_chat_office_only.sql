-- Team Chat (0021) was built as one room the whole company lands in
-- automatically - admins, supervisors and cleaners alike. It's meant to be
-- an office channel, so cleaners come out of it: they keep their 1:1
-- chats, with the office and with each other, and only lose the shared
-- group.
--
-- Their messages in the group are deliberately left in place. They're part
-- of a conversation office staff are still having, and quietly deleting
-- what someone wrote isn't what "take them out of the room" means. Losing
-- their read state alongside the participant row is fine - there's nothing
-- left for them to have read.

-- Auto-join on account creation, narrowed from 0036. Supervisors stay:
-- they run the rota, clients and messages day to day (0035), so the
-- office channel is theirs as much as an admin's.
create or replace function add_to_team_chat() returns trigger as $$
declare
  team_chat_id uuid;
begin
  if new.role in ('admin', 'supervisor') then
    select id into team_chat_id from public.conversations where type = 'group' limit 1;
    if team_chat_id is not null then
      insert into public.conversation_participants (conversation_id, profile_id)
      values (team_chat_id, new.id)
      on conflict (conversation_id, profile_id) do nothing;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Anyone the old trigger already put there. Scoped to group conversations
-- so a cleaner's direct chats are untouched - "delete from participants
-- where the profile is a cleaner" would take those with it.
delete from conversation_participants cp
using conversations c, profiles p
where cp.conversation_id = c.id
  and cp.profile_id = p.id
  and c.type = 'group'
  and p.role = 'cleaner';
