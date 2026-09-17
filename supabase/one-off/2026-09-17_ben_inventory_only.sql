-- Run AFTER migrations/0101_inventory_role.sql (the role has to pass the
-- profiles_role_check constraint first). Ben was added on 2026-09-17 as a
-- cleaner; this makes him inventory only. Nothing else about the account
-- changes.

update profiles
set role = 'inventory'
where id = 'cac55bef-3bdd-40d8-a200-ca93096c62a3'
  and role = 'cleaner';

-- Expect one row: role = inventory.
select id, full_name, role, active from profiles
where id = 'cac55bef-3bdd-40d8-a200-ca93096c62a3';
