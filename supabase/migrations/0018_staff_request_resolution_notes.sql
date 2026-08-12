-- Lets admin leave a short note when resolving a kit top-up/issue request,
-- so the cleaner who raised it can see what actually happened rather than
-- the item just silently disappearing off their list.
alter table staff_requests add column resolution_note text;
