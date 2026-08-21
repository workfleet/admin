-- Key & alarm-code custody register: which keys, fobs and access codes
-- exist for each site, who is holding each one right now, and the full
-- handover trail behind that. Clauses 11.1-11.8 of the worker contract
-- make the company responsible for every key it issues and give it the
-- right to recover the cost of one that isn't returned - but until now
-- nothing in the app could answer "who has the key to this site?".
--
-- Deliberately records custody, NOT secrets: there is no column for the
-- actual alarm code, key-safe combination or keypad PIN. A live alarm
-- code sitting in a table that every admin and supervisor can read is
-- precisely the liability this feature exists to reduce. What's tracked
-- is that a code was issued to someone, when, and when it was handed
-- back (i.e. when it needs changing) - the code itself stays out of the
-- database, same as it stays out of the app today.

create table site_keys (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references properties(id) on delete cascade not null,
  label text not null,
  kind text not null default 'key' check (kind in ('key', 'fob', 'alarm_code', 'other')),
  notes text,
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index site_keys_property_id_idx on site_keys(property_id);

-- One row per handover. The open row (returned_at is null) is who holds
-- it now; the closed rows are the audit trail. Nothing is ever deleted
-- on return - that history is the point.
create table key_holdings (
  id uuid primary key default gen_random_uuid(),
  key_id uuid references site_keys(id) on delete cascade not null,
  holder_id uuid references profiles(id) on delete cascade not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references profiles(id) on delete set null,
  issue_note text,
  due_back_at date,
  acknowledged_at timestamptz,
  acknowledged_signature text,
  returned_at timestamptz,
  returned_to uuid references profiles(id) on delete set null,
  return_note text,
  created_at timestamptz not null default now()
);

create index key_holdings_key_id_idx on key_holdings(key_id, issued_at desc);
create index key_holdings_holder_id_idx on key_holdings(holder_id);

-- A key is in exactly one person's hands at a time. A partial unique
-- index makes a double-issue impossible at the database rather than
-- merely discouraged in the UI.
create unique index key_holdings_one_open_per_key on key_holdings(key_id) where returned_at is null;

alter table site_keys enable row level security;
alter table key_holdings enable row level security;

-- security definer for the same reason as assigned_job_ids() in 0030:
-- the site_keys policy needs to read key_holdings, and the properties
-- policy needs to read both, without recursing into their own RLS.
create or replace function held_key_ids() returns setof uuid as $$
  select key_id from key_holdings where holder_id = auth.uid() and returned_at is null
$$ language sql security definer stable;

create or replace function key_holder_property_ids() returns setof uuid as $$
  select sk.property_id
  from site_keys sk
  join key_holdings kh on kh.key_id = sk.id
  where kh.holder_id = auth.uid() and kh.returned_at is null
$$ language sql security definer stable;

create policy "site_keys: admin or supervisor manage" on site_keys
  for all using (is_admin_or_supervisor());

create policy "site_keys: holder select" on site_keys
  for select using (id in (select held_key_ids()));

create policy "key_holdings: admin or supervisor manage" on key_holdings
  for all using (is_admin_or_supervisor());

create policy "key_holdings: holder select own" on key_holdings
  for select using (holder_id = auth.uid());

-- Signing for a key you've been handed is the one write a cleaner makes
-- here. The policy can only say "this row is yours"; it can't express
-- "and you changed nothing except the signature", so the trigger below
-- does that half.
create policy "key_holdings: holder acknowledge own" on key_holdings
  for update using (holder_id = auth.uid() and is_active_cleaner());

-- A cleaner may hold a key for a site they have no job at (covering,
-- or holding it between contracts), and the register is useless if the
-- app can't show them which door it opens.
create policy "properties: key holder select" on properties
  for select using (id in (select key_holder_property_ids()));

create or replace function enforce_key_holding_holder_update() returns trigger as $$
begin
  if is_admin_or_supervisor() then
    return new;
  end if;

  if new.key_id is distinct from old.key_id
    or new.holder_id is distinct from old.holder_id
    or new.issued_at is distinct from old.issued_at
    or new.issued_by is distinct from old.issued_by
    or new.issue_note is distinct from old.issue_note
    or new.due_back_at is distinct from old.due_back_at
    or new.returned_at is distinct from old.returned_at
    or new.returned_to is distinct from old.returned_to
    or new.return_note is distinct from old.return_note then
    raise exception 'You can only sign for a key, not change its record';
  end if;

  -- Signing is once and final - it's evidence of a handover, so it
  -- can't be quietly re-signed under a different name later. Returning
  -- a key is recorded by admin, never by the holder, for the same
  -- reason: nobody marks their own key back in.
  if old.acknowledged_at is not null then
    raise exception 'This handover has already been signed for';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger key_holdings_restrict_holder_update
  before update on key_holdings
  for each row execute procedure enforce_key_holding_holder_update();

-- Same in-app notification path as a shift assignment (0030) - the
-- holder needs to know something is now their responsibility, and the
-- prompt is what gets the signature collected.
create or replace function notify_on_key_issued() returns trigger as $$
begin
  insert into public.notifications (user_id, message)
  select new.holder_id,
    'Key issued to you: ' || sk.label || ' (' || p.address || ') - please confirm you have it'
  from public.site_keys sk
  join public.properties p on p.id = sk.property_id
  where sk.id = new.key_id;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_key_holding_created
  after insert on key_holdings
  for each row execute procedure notify_on_key_issued();
