-- Contract/SLA renewal tracking so a contract can't quietly lapse -
-- protects revenue rather than just tidying admin, same spirit as the
-- existing client review reminders but value/date specific.
alter table clients add column contract_value numeric(10,2);
alter table clients add column contract_renewal_date date;
alter table clients add column contract_notice_days integer;
