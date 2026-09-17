-- The Team Chat group room (0021) is being retired (asked for 2026-09-17).
-- It was the one room every office account landed in automatically, and it
-- has not been used since 5 September; one-to-one messages between staff and
-- the office carry the real traffic and are untouched here.
--
-- Nothing in the app creates a group room, so once this one is gone there
-- is nothing for the auto-join trigger to add people to - it goes too,
-- rather than sit there firing into nothing on every new account. Deleting
-- the conversation takes its members and messages with it (both reference
-- conversations with on delete cascade). The messages pages already treat a
-- group as optional, so they simply show the direct chats.

drop trigger if exists profiles_add_to_team_chat on profiles;
drop function if exists add_to_team_chat();

delete from conversations where type = 'group';
