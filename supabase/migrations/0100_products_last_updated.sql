-- The Inventory page could not say when the stock was last counted, or by
-- whom. A shopping list built from a count nobody has touched since July
-- looks the same as one counted this morning, and when a figure looks wrong
-- there is no way to know who to ask.
--
-- products gets the same pair staff_bank_details (0099) carries: updated_at
-- and updated_by. They are stamped by a trigger rather than by the page, so
-- every write path - the +/- counting on the Inventory page, a product added
-- or renamed, anything done by hand in the dashboard - is covered without
-- each one having to remember. auth.uid() is null for service-role and
-- direct-SQL callers (see 0037); those keep whatever updated_by they set
-- themselves, or none, rather than being credited to the previous person.
--
-- Existing rows take their created_at as the last update, because that is
-- the only date on record for them - claiming they were all updated the
-- moment this migration ran would be a lie.

alter table products
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid constraint products_updated_by_fkey references profiles(id) on delete set null;

update products set updated_at = created_at;

create or replace function stamp_products_last_updated() returns trigger as $$
begin
  -- A save that changes nothing is not an update worth reporting.
  if tg_op = 'UPDATE' and new is not distinct from old then
    return new;
  end if;

  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' and new.updated_by is not distinct from old.updated_by then
    new.updated_by := null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists products_stamp_last_updated on products;
create trigger products_stamp_last_updated
  before insert or update on products
  for each row execute procedure stamp_products_last_updated();
