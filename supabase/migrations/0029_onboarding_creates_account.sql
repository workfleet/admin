-- Onboarding now creates the new starter's login account directly (see
-- app/api/onboarding/[token]/submit), instead of relying on the separate
-- public self-signup on the login page. This links the submission back
-- to the account it created.
alter table staff_onboarding_submissions add column if not exists profile_id uuid references profiles(id);
