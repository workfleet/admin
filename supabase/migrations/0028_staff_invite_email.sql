-- Lets admin send the onboarding link straight to a new starter's inbox
-- instead of only generating a link to copy/share manually.
alter table staff_invites add column if not exists email text;
