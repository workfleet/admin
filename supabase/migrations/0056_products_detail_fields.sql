-- The real inventory list has fractional stock (e.g. 1.5 rolls) and
-- carries location/supplier/price detail worth keeping rather than
-- flattening down to just a bare stock count.
alter table products alter column stock_level type numeric(10,2) using stock_level::numeric;
alter table products alter column stock_level set default 0;
alter table products alter column reorder_threshold type numeric(10,2) using reorder_threshold::numeric;
alter table products alter column reorder_threshold set default 0;
alter table products add column location text;
alter table products add column supplier text;
alter table products add column unit_price numeric(10,2);
