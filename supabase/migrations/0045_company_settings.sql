-- Who the company is, as data rather than as code.
--
-- These values appear on every document a client receives - the quote
-- letterhead, the footer, the statutory line - and they change without
-- warning: a new phone number, a move, a rebrand. Holding them in
-- lib/companyBranding.js meant a deploy for each one, and a stale
-- registered office on paperwork already sent.
--
-- Single row, like pricing_settings: this is one company's identity, not
-- a list. The fixed id lets the app select it without guessing.
create table company_settings (
  id uuid primary key default gen_random_uuid(),
  trading_name text not null default 'CrewConnect Cleaning',
  legal_name text not null default 'CrewConnect RPO Ltd',
  registered_office text not null default '164 Gorseinon Road, Penllergaer, Swansea, SA4 9AA',
  company_number text not null default '16327874',
  address text not null default 'Penllergaer, Swansea, South Wales',
  phone text not null default '07350 136763',
  email text not null default 'info@crewconnect.ltd',
  website text not null default 'crewconnect.ltd',
  brand_color text not null default '#2fa5a9',
  updated_at timestamptz not null default now()
);

insert into company_settings (id) values ('00000000-0000-0000-0000-000000000001');

alter table company_settings enable row level security;

-- Readable by anyone signed in: this is the contact information the
-- company puts on its own paperwork, not private data, and the client
-- portal will need it too so it can stop carrying a compiled-in copy.
-- Only an admin changes who the company is.
create policy "company_settings: authenticated select" on company_settings for select using (auth.role() = 'authenticated');
create policy "company_settings: admin update" on company_settings for update using (is_admin());
