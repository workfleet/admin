-- A cleaner's Messages page now offers only the office under New Chat: the
-- rest of the team is not theirs to browse or pick. The function behind
-- that button (0021) had no view on who may talk to whom, so a call made
-- outside the page could still open a chat with any account. Now a caller
-- who is not office staff may only open a chat with office staff; the
-- office may open one with anyone, as before. Chats that already exist are
-- untouched and still open for both sides.
create or replace function create_direct_conversation(other_profile_id uuid) returns uuid as $$
declare
  conv_id uuid;
  other_role text;
begin
  if not is_admin_or_supervisor() then
    select role into other_role from profiles where id = other_profile_id;
    if other_role is null or other_role not in ('admin', 'supervisor') then
      raise exception 'Staff can only start a chat with the office';
    end if;
  end if;

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
