-- add_to_team_chat() (0021, widened in 0035) referenced "conversations" and
-- "conversation_participants" unqualified. That resolves fine when the
-- trigger fires under a session whose search_path includes "public" (e.g.
-- PostgREST's authenticated role), but GoTrue's own internal role does not
-- have "public" on its search_path - so every new account created via the
-- admin API (onboarding, "Add Staff", this migration's own supervisor
-- creation) was failing with "relation conversations does not exist" and
-- aborting the whole auth.users insert. Schema-qualify the table names so
-- the trigger works regardless of the caller's search_path.

create or replace function add_to_team_chat() returns trigger as $$
declare
  team_chat_id uuid;
begin
  if new.role in ('admin', 'supervisor', 'cleaner') then
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
