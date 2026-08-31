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
create table quote_template_sections (
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

create index quote_template_sections_position_idx on quote_template_sections (position);

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
  ('acceptance_short', 'Acceptance', '', 220, 'short', null, true);

alter table quote_template_sections enable row level security;

-- Anyone who can write a quote needs to read the wording it will carry;
-- only an admin changes what the company says.
create policy "quote_template_sections: staff select" on quote_template_sections for select using (is_admin_or_supervisor());
create policy "quote_template_sections: admin write" on quote_template_sections for all using (is_admin());
