-- The order the team comes down the by-cleaner rota, shared by the office.
--
-- The rota's "Arrange" order was kept in each browser, so Nikki's order
-- never reached anyone else's screen. It lives here now, on the one
-- company_settings row: a list of staff ids, top of the rota first.
-- Anyone not in the list (someone new) is drawn at the end, A to Z, and
-- an id for someone who has left is simply skipped.
--
-- Readable by anyone signed in and changed only by an admin, by the
-- policies company_settings already has (0045a).
alter table company_settings
  add column if not exists rota_staff_order jsonb not null default '[]'::jsonb;
