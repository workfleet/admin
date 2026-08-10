alter table clients
  add column if not exists contact_name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists billing_address text,
  add column if not exists notes text;
