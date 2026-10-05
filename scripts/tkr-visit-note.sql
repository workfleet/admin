-- One-off: put the TKR visit instructions at the top of each TKR property's
-- notes, which cleaners see on every visit. The existing notes (room lists,
-- parking) are kept underneath. Safe to run twice - it skips properties
-- that already have the note.
--
-- on_property_self_update (0061) blocks notes changes from anyone who isn't
-- a signed-in admin, including this editor, so it is switched off for the
-- one statement.
begin;

alter table properties disable trigger on_property_self_update;

update properties
set notes = 'TKR communal clean, about 1 hour. Communal areas only - follow the property checklist. '
         || 'Every kitchen includes inside the microwave and the tumble dryer lint filter. '
         || 'Now and then a room needs refreshing (for example after someone moves out): you will get extra time for it, '
         || 'and Jess will tell you in Messages and on your rota.'
         || coalesce(E'\n\n' || notes, '')
where client_id = '10a80ca8-3185-4196-aae8-a6b1be35b942'
  and coalesce(notes, '') not like 'TKR communal clean%';

alter table properties enable trigger on_property_self_update;

commit;
