-- Quoting: a priced proposal for cleaning work, sent to either an
-- existing client or a prospect who isn't in the system yet (prospect_*
-- fields cover that case since there's no client_id to point at). Kept
-- deliberately separate from jobs/rota - accepting a quote doesn't
-- auto-create anything, it's just a record of what was proposed and
-- whether it was accepted, same as everything else admin tracks by hand
-- today (call logs, reviews).
create table quotes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  prospect_name text,
  prospect_email text,
  prospect_phone text,
  description text not null,
  price numeric(10,2) not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'expired')),
  valid_until date,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (client_id is not null or prospect_name is not null)
);

alter table quotes enable row level security;

create policy "quotes: admin or supervisor all" on quotes for all using (is_admin_or_supervisor());
