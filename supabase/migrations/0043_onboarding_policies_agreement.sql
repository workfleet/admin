-- Tracks that a new starter explicitly ticked "I have read and agree to
-- follow these policies" during onboarding, alongside the existing
-- contract signature - a separate acknowledgment from the contract itself.
alter table staff_onboarding_submissions add column policies_agreed boolean not null default false;
