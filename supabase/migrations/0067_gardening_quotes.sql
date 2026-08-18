-- Gardening gets its own hourly wage (£15 vs £13 for cleaning), but
-- reuses every other cost-plus setting as-is (holiday/NI/pension %,
-- materials/admin %, travel, target margin, minimum price) - same
-- pattern as adding a second wage column, not a second settings row.
alter table pricing_settings add column if not exists gardener_hourly_pay numeric(10,2) not null default 15.00;
