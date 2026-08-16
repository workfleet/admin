-- Backs the quote price calculator (ported from the CrewConnect quoting
-- spreadsheet's "Pricing Settings" tab) - the numbers that drive cost-plus
-- pricing (wage, oncosts, margin, minimum job price) live here so they can
-- be tuned without a code change. Room-time benchmarks, multipliers, and
-- the add-on catalog stay as code constants (lib/quoteCalculator.js) since
-- unlike these, they weren't asked to be admin-editable and define the
-- calculator's actual shape, not just its numbers.
--
-- Singleton row - the app always reads/writes the one row seeded below.
-- Read access matches quotes (admin or supervisor, since supervisors also
-- create quotes and need the calculator to work), but editing the
-- financial assumptions themselves is admin-only, same sensitivity level
-- as payroll.
create table pricing_settings (
  id uuid primary key default gen_random_uuid(),
  cleaner_hourly_pay numeric(10,2) not null default 13.00,
  holiday_allowance_pct numeric(6,4) not null default 0.1207,
  employer_ni_pct numeric(6,4) not null default 0.08,
  pension_pct numeric(6,4) not null default 0.03,
  materials_pct numeric(6,4) not null default 0.05,
  admin_pct numeric(6,4) not null default 0.05,
  travel_cost_per_mile numeric(10,2) not null default 0.45,
  target_margin_pct numeric(6,4) not null default 0.275,
  minimum_job_price numeric(10,2) not null default 120.00,
  minimum_callout_hours numeric(5,2) not null default 3.0,
  updated_at timestamptz not null default now()
);

insert into pricing_settings (id) values ('00000000-0000-0000-0000-000000000001');

alter table pricing_settings enable row level security;

create policy "pricing_settings: staff select" on pricing_settings for select using (is_admin_or_supervisor());
create policy "pricing_settings: admin update" on pricing_settings for update using (is_admin());

-- Preserves what was entered into the calculator (room counts, condition,
-- add-ons chosen etc.) and the computed breakdown (hours, cost stack,
-- margin, price position) alongside the quote, so a calculator-generated
-- quote can be reviewed or re-derived later. Null for quotes entered
-- manually without the calculator - both flows write to the same
-- description/price columns already on this table.
alter table quotes add column calculator_input jsonb;
alter table quotes add column calculator_breakdown jsonb;
