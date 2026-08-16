-- Audit trail: who marked a kit top-up/issue request resolved, not just
-- when. time_off_requests and time_extension_requests already track this
-- via decided_by - staff_requests never had the equivalent column.
alter table staff_requests add column resolved_by uuid references profiles(id) on delete set null;
