-- Lets admin tag each client with the industry they're in, so the client
-- list can show/filter what industries the business covers.
alter table clients add column industry text;
