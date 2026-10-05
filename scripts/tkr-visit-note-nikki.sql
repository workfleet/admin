-- One-off (2026-10-05): the TKR visit note (scripts/tkr-visit-note.sql) says
-- Jess tells cleaners about room refreshes. It's Nikki.
--
-- on_property_self_update (0061) blocks notes changes from this editor, so
-- it is switched off for the one statement.
begin;

alter table properties disable trigger on_property_self_update;

update properties
set notes = replace(notes, 'and Jess will tell you in Messages', 'and Nikki will tell you in Messages')
where client_id = '10a80ca8-3185-4196-aae8-a6b1be35b942'
  and notes like '%and Jess will tell you in Messages%';

alter table properties enable trigger on_property_self_update;

commit;

-- Should be 22 rows with Nikki and none with Jess.
select
  count(*) filter (where notes like '%Nikki will tell you%') as nikki,
  count(*) filter (where notes like '%Jess will tell you%') as jess
from properties
where client_id = '10a80ca8-3185-4196-aae8-a6b1be35b942';
