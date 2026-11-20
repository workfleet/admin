-- 0155: clients can read the checklist for their own properties.
--
-- The client portal's Rooms page (Nov 2026, for TKR) lists each house's
-- communal areas under its "Communal areas" row, from the property
-- checklist (hallway, landing, stairs, kitchen...). Until now only staff
-- could read property_checklist_items (0054, 0087), so a client saw the row
-- without the list. Read only, and only their own properties - the same set
-- the jobs policy already lets them see (client_property_ids, 0002).

drop policy if exists "property_checklist_items: client own" on property_checklist_items;
create policy "property_checklist_items: client own" on property_checklist_items
  for select using (property_id in (select client_property_ids()));
