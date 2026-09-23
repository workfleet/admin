-- Onboarding invites carry the terms of the contract the new starter will
-- sign, so the office fills them in once before sending the link instead of
-- every hire signing the same hard-coded £13/hr Cleaning Operative contract
-- that lived in app/onboard/[token]/page.js.
--
-- Two kinds of column here, deliberately named apart:
--   * the contract terms (job_title ... reports_to) are the Company's side of
--     the agreement. The new starter sees them but cannot change them.
--   * the expected_* columns are a head start on the new starter's own
--     details - prefilled by the office, editable by them on the form, and
--     never used to build the contract directly. What ends up in the
--     contract is what they actually submitted.
alter table staff_invites
  add column if not exists job_title text not null default 'Cleaning Operative',
  add column if not exists hourly_rate numeric(10,2),
  add column if not exists pay_frequency text not null default 'weekly'
    check (pay_frequency in ('weekly', 'fortnightly', 'monthly')),
  add column if not exists start_date date,
  add column if not exists reports_to text,
  add column if not exists expected_address text,
  add column if not exists expected_phone text,
  add column if not exists expected_date_of_birth date;

-- Null rate means "the standard rate at the time the link was made", which
-- the admin form fills in from pricing_settings.cleaner_hourly_pay. Rows
-- created before this migration have no stored rate, and the contract they
-- signed is already in contract_text, so nothing is backfilled.
comment on column staff_invites.hourly_rate is
  'Hourly pay written into this hire''s contract. Null on invites created before 0114.';

-- The signed contract is filed as a PDF in the shared document library
-- (0048) and pointed at that one person with company_document_recipients
-- (0049), so it shows up in their Documents tab and nobody else's. This is
-- the link back, so the office can get to the file from the onboarding
-- record. On delete set null: removing the document from the library must
-- not take the signed submission with it - contract_text is the record of
-- what was agreed, the PDF is a rendering of it.
alter table staff_onboarding_submissions
  add column if not exists contract_document_id uuid references company_documents(id) on delete set null;
