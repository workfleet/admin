-- Retention needs a clock to count from. Neither table had one:
-- deactivating a cleaner just flips profiles.active, and clients have
-- no "relationship ended" concept at all today (they're either active
-- or hard-deleted immediately via the existing Delete Client flow,
-- which already cascades their data away - no retention gap there).
-- This adds the two missing timestamps the retention job (see
-- app/api/admin/enforce-retention) counts 6 years from.

alter table profiles add column if not exists deactivated_at timestamptz;

create or replace function track_profile_deactivation() returns trigger as $$
begin
  if new.active = false and old.active = true then
    new.deactivated_at := now();
  elsif new.active = true and old.active = false then
    new.deactivated_at := null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger on_profile_active_change
  before update on profiles
  for each row execute procedure track_profile_deactivation();

-- Admin-set only - the retention job never guesses an end date, it
-- only ever acts on clients this has explicitly been set for.
alter table clients add column if not exists relationship_ended_at timestamptz;
