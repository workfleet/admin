-- ============================================================
-- One-off: apply the four migrations that were never run against
-- the live database (project zoogbqlkprhtvosrnlrj).
--
-- Found on 2026-08-31 by scripts/schema-drift-check.js. These files have
-- been in the repo for some time, but the database never received them, so
-- four features have been running on hard-coded fallbacks:
--
--   0045a_company_settings          the admin "company details" form
--                                   cannot save; documents fall back to the
--                                   COMPANY constant in lib/companyBranding.js
--   0046b_quote_template_sections   /admin/quotes/wording is broken; quotes
--                                   fall back to the wording in lib/quoteTemplate.js
--   0065_push_subscriptions         push notifications have never worked at
--                                   all - every EnablePush write fails silently
--   0071_commercial_recurring_minimum  recurring commercial quotes use the
--                                   built-in 1.5h default rather than a
--                                   configurable one
--
-- Applied in migration-number order. No later migration references any of
-- these tables, and everything they depend on (is_admin, is_admin_or_supervisor,
-- profiles, pricing_settings, auth.uid) already exists in the database - so
-- this fills the gaps without disturbing anything applied since.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste all of this -> Run.
--
-- It runs as a single transaction: if any statement fails, nothing is applied
-- and you can re-run after fixing the cause. It is also safe to run twice -
-- every object is created "if not exists", both seed inserts are
-- "on conflict do nothing", and each policy is dropped before being recreated.
--
-- Expect the last statement to return four rows, all reading 'ok'.
-- ============================================================

begin;

-- ============================================================
-- 0045a_company_settings.sql
-- ============================================================

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
create table if not exists company_settings (
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

insert into company_settings (id) values ('00000000-0000-0000-0000-000000000001')
  on conflict (id) do nothing;

alter table company_settings enable row level security;

-- Readable by anyone signed in: this is the contact information the
-- company puts on its own paperwork, not private data, and the client
-- portal will need it too so it can stop carrying a compiled-in copy.
-- Only an admin changes who the company is.
drop policy if exists "company_settings: authenticated select" on company_settings;
create policy "company_settings: authenticated select" on company_settings for select using (auth.role() = 'authenticated');
drop policy if exists "company_settings: admin update" on company_settings;
create policy "company_settings: admin update" on company_settings for update using (is_admin());


-- ============================================================
-- 0046b_quote_template_sections.sql
-- ============================================================

-- The wording of a quotation, as rows rather than as code.
--
-- Everything a quote says used to live in lib/quoteTemplate.js: the
-- introduction, the duty lists, RAMS, COSHH, health and safety, quality
-- control, client requirements. Changing a sentence meant a deploy, and
-- there was no way to drop a section for one kind of job or reorder them.
--
-- Sections are either generated or prose. A generated section is built
-- from the quote itself - the scope, the schedule, the pricing table,
-- the contract value - so its body is ignored and only its title,
-- position and whether it appears are editable. A prose section is
-- entirely the admin's text.
--
-- body markup, kept to three things an admin can hold in their head:
--   a blank line starts a new paragraph
--   a line beginning "## " is a subheading
--   a line beginning "- " is a bullet
--
-- Placeholders substituted at render time:
--   {company}         the trading name from company_settings
--   {client}          who the quote is for
--   {site}            the site address, or the client if there isn't one
--   {initial_period}  "The initial contract period is proposed as N weeks."
--
-- document: 'contract' for the full proposal, 'short' for the one-page
-- version, 'both' for either. service_types null means every service.
--
-- Seeded from the wording that was in the code at the time of writing,
-- so applying this changes nothing about existing quotes.
create table if not exists quote_template_sections (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  title text not null,
  body text not null default '',
  position integer not null,
  document text not null default 'contract' check (document in ('contract', 'short', 'both')),
  service_types text[],
  generated boolean not null default false,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists quote_template_sections_position_idx on quote_template_sections (position);

insert into quote_template_sections (key, title, body, position, document, service_types, generated) values
  ('introduction', 'Introduction', '{company} is pleased to submit this quotation for the provision of professional cleaning services at {site}.

We will provide appropriately trained operatives, materials and supervision required to deliver the agreed specification.', 10, 'contract', array['cleaning', 'gardening']::text[], false),
  ('introduction_commercial', 'Introduction', '{company} is pleased to submit this quotation for the provision of professional commercial cleaning services at {site}.

Our proposed service has been designed to provide consistent cleaning coverage across the agreed working pattern, ensuring the site is maintained to a high standard throughout the week.

We will provide appropriately trained operatives, materials and supervision required to deliver the agreed specification.', 20, 'contract', array['commercial']::text[], false),
  ('scope', 'Scope of Works', '', 30, 'both', null, true),
  ('schedule', 'Proposed Cleaning Schedule', '', 40, 'contract', null, true),
  ('total_hours', 'Total Cleaning Hours', '', 50, 'contract', null, true),
  ('service_detail', 'Service Detail', '', 60, 'contract', null, true),
  ('inclusions', 'What''s Included', '', 70, 'short', null, true),
  ('duties_commercial', 'Cleaning Duties', 'The proposed service will include, subject to the final site specification:

## Public areas

- Sweeping floors
- Vacuuming where applicable
- Mopping hard floors
- Machine scrubbing of designated floor areas
- Spot cleaning
- Cleaning entrance, circulation and waiting areas

## Toilets and washrooms

- Cleaning and disinfecting toilets
- Cleaning sinks, wash basins and mirrors
- Cleaning floors and touch points
- Emptying sanitary and general waste bins
- Replenishing consumables where supplied or agreed

## High-touch areas

- Door handles and push plates
- Handrails
- Other frequently touched surfaces

## Waste

- Emptying general waste bins and replacing liners
- Removing waste to the agreed on-site waste location
- Reporting overflowing or problematic waste areas', 80, 'contract', array['commercial']::text[], false),
  ('duties_cleaning', 'Cleaning Duties', 'The proposed service will include, subject to the final site specification:

## Included as standard

- Fridge clean
- Freezer clean
- Dishwasher clean
- Washing machine clean
- Internal windows & blinds

## Quoted separately on request

- Carpet cleaning
- Upholstery cleaning
- Rubbish removal', 90, 'contract', array['cleaning']::text[], false),
  ('duties_gardening', 'Works Included', 'The proposed service will include, subject to the final site specification:

## Grounds maintenance

- Mowing and edging of lawned areas
- Weeding of borders and beds
- Pruning and general tidying
- Clearance of cuttings and debris from worked areas', 100, 'contract', array['gardening']::text[], false),
  ('staffing', 'Staffing', '{company} will provide suitably trained and competent operatives to undertake the agreed schedule.

Staff will be expected to:

- Attend site at the agreed times
- Wear appropriate workwear and PPE
- Follow site rules and procedures
- Follow the agreed specification
- Use equipment safely
- Report hazards, defects and maintenance issues
- Maintain professional standards when working in occupied or public areas

A suitable management and supervision structure will be maintained by {company} throughout the contract.', 110, 'contract', null, false),
  ('rams', 'RAMS - Risk Assessments & Method Statements', '{company} will provide site-specific RAMS prior to commencement of the contract, covering the activities undertaken by our operatives, including where applicable:

- General cleaning activities and floor cleaning
- Use of cleaning chemicals and COSHH controls
- Use of any powered cleaning equipment
- Manual handling
- Slips, trips and falls
- Working in an occupied or public environment
- PPE requirements
- Safe storage of equipment and chemicals
- Emergency procedures and the reporting of hazards and incidents

The RAMS will be reviewed with relevant staff before work commences, and updated where there are significant changes to the working environment, equipment or requirements.', 120, 'contract', array['commercial']::text[], false),
  ('coshh', 'COSHH', '{company} will ensure that appropriate COSHH information is available for the chemicals used as part of the service. Operatives will be instructed in:

- Safe chemical handling and correct dilution
- Appropriate PPE
- Safe storage and spill procedures
- Correct use of chemical products in line with manufacturer instructions

Only approved products will be used, in accordance with the agreed site requirements.', 130, 'contract', array['cleaning', 'commercial']::text[], false),
  ('health_safety', 'Health & Safety', '{company} is committed to maintaining high standards of health and safety. All operatives are required to follow our health and safety procedures, site-specific rules, RAMS, COSHH procedures, safe systems of work and PPE requirements.

Wet floor signs and other appropriate warning measures will be used where necessary, with particular attention given to maintaining safe pedestrian routes while work is in progress.', 140, 'contract', null, false),
  ('quality', 'Quality Control', 'Quality standards will be maintained through:

- Regular management oversight
- Staff supervision
- Documented on-site checks
- Review of the agreed specification
- Customer feedback and corrective action where required

Any issues identified by the client will be addressed promptly and communicated to the appropriate {company} management representative.', 150, 'contract', null, false),
  ('pricing', 'Pricing', '', 160, 'both', null, true),
  ('contract_value', 'Contract Value', '', 170, 'both', null, true),
  ('materials', 'Equipment & Materials', '{company} will provide the standard equipment and materials required to carry out the agreed duties.

Any specialist equipment requested outside the agreed specification may be subject to an additional charge, subject to prior agreement. Where the client provides machinery for our operatives to use, servicing, repairs and mechanical faults remain the responsibility of the client unless otherwise agreed.', 180, 'contract', null, false),
  ('contract_review', 'Contract Review', '{initial_period}During the initial period, {company} will work with the client to establish the most effective routines, staffing requirements and frequencies.

Following the initial period, the service can be reviewed and continued under an agreed ongoing contract.', 190, 'contract', null, false),
  ('client_requirements', 'Client Requirements', 'To allow {company} to deliver the service effectively, the client will be asked to provide:

- Appropriate site access at the agreed times
- Access to the agreed working areas
- Suitable storage facilities for equipment where available
- Access to agreed water and waste disposal facilities
- Any relevant site-specific health and safety information
- Details of any restricted areas or operational requirements
- Parking where possible', 200, 'contract', null, false),
  ('acceptance', 'Acceptance', '', 210, 'contract', null, true),
  ('acceptance_short', 'Acceptance', '', 220, 'short', null, true)
  on conflict (key) do nothing;

alter table quote_template_sections enable row level security;

-- Anyone who can write a quote needs to read the wording it will carry;
-- only an admin changes what the company says.
drop policy if exists "quote_template_sections: staff select" on quote_template_sections;
create policy "quote_template_sections: staff select" on quote_template_sections for select using (is_admin_or_supervisor());
drop policy if exists "quote_template_sections: admin write" on quote_template_sections;
create policy "quote_template_sections: admin write" on quote_template_sections for all using (is_admin());


-- ============================================================
-- 0065_push_subscriptions.sql
-- ============================================================

-- Web Push subscriptions, one row per device a user has enabled
-- notifications on (a user can have several - phone, laptop, etc).
-- Currently only used to reach admin/supervisor on their phones for
-- emergency alerts, but kept generic (any signed-in user, any device)
-- rather than admin-only, so other notification types can reuse it
-- later without a schema change.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

drop policy if exists "push_subscriptions: user manage own" on push_subscriptions;
create policy "push_subscriptions: user manage own" on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "push_subscriptions: admin all" on push_subscriptions;
create policy "push_subscriptions: admin all" on push_subscriptions
  for all using (is_admin());


-- ============================================================
-- 0071_commercial_recurring_minimum.sql
-- ============================================================

-- The £120 minimum job price and 3-hour minimum call-out (0042) are
-- one-off job assumptions: they cover mobilising a cleaner, getting them
-- to an unfamiliar property, and the risk of not filling the rest of
-- that day. Charged against every visit of a standing contract they
-- compound into nonsense - a daily two-hour office clean was quoting at
-- £120 a visit, £2,600 a month, roughly triple what that work sells for.
--
-- On a recurring route none of those costs recur per visit, so recurring
-- commercial work is priced on the cost-plus stack alone, floored only
-- by the shortest visit worth dispatching someone for. One-off commercial
-- is still a one-off job and keeps the 0042 floors untouched.
--
-- Hours rather than a price floor deliberately: a contract is sold as
-- hours at a rate, and a minimum visit length is something a client
-- understands and will agree to. A hidden per-visit price floor just
-- makes the rate card stop adding up.
alter table pricing_settings
  add column if not exists commercial_recurring_min_hours numeric(5,2) not null default 1.5;


-- ============================================================
-- Verification. All four rows should read 'ok'.
-- ============================================================
select '0045a company_settings' as migration,
       case when to_regclass('public.company_settings') is not null
             and exists (select 1 from company_settings)
            then 'ok' else 'MISSING' end as result
union all
select '0046b quote_template_sections',
       case when to_regclass('public.quote_template_sections') is not null
             and (select count(*) from quote_template_sections) = 22
            then 'ok' else 'MISSING' end
union all
select '0065 push_subscriptions',
       case when to_regclass('public.push_subscriptions') is not null
            then 'ok' else 'MISSING' end
union all
select '0071 commercial_recurring_min_hours',
       case when exists (
              select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = 'pricing_settings'
                and column_name = 'commercial_recurring_min_hours')
            then 'ok' else 'MISSING' end;

commit;
