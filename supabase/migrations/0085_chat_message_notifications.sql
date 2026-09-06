-- Tell people when someone messages them.
--
-- Team Chat and direct messages (0021) wrote the message and stopped. A
-- direct message asked api/notify for an email; a group message asked for
-- nothing at all. Neither put anything in the bell, and neither pushed to a
-- phone. So a cleaner could post in Team Chat, or message the office
-- directly, and the first anyone knew was the next time they happened to
-- open Messages.
--
-- The in-app notification is written here, by trigger, for every other
-- participant in the conversation. A trigger rather than app code because
-- there are two pages that send messages today and there will be more, and
-- a notification that depends on the sender's page remembering to send one
-- is the gap this is closing. Push and email stay in api/notify, which is
-- the only place that can reach a phone.
create or replace function notify_participants_on_chat_message() returns trigger as $$
declare
  sender_name text;
  conv_type text;
  conv_name text;
  snippet text;
begin
  select full_name into sender_name from public.profiles where id = new.sender_id;
  select type, name into conv_type, conv_name from public.conversations where id = new.conversation_id;

  -- Enough to know whether to open it, not the whole message: the bell is
  -- a list, and a long paragraph in it hides everything under it.
  snippet := left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 90);
  if length(coalesce(new.body, '')) > 90 then snippet := snippet || '…'; end if;

  insert into public.notifications (user_id, message)
  select cp.profile_id,
    coalesce(sender_name, 'Someone')
    || case when conv_type = 'group' then ' in ' || coalesce(conv_name, 'Team Chat') else '' end
    || ': ' || snippet
  from public.conversation_participants cp
  where cp.conversation_id = new.conversation_id
    and cp.profile_id <> new.sender_id;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists chat_message_notifies_participants on chat_messages;
create trigger chat_message_notifies_participants
  after insert on chat_messages
  for each row execute procedure notify_participants_on_chat_message();
