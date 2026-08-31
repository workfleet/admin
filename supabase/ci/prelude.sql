-- Just enough Supabase to replay this repo's SQL into a plain Postgres.
--
-- `schema.sql` and the migrations are written against a Supabase project, so
-- they lean on things a bare Postgres has never heard of: the `auth` and
-- `storage` schemas, the `authenticated` role that RLS policies are granted
-- to, and `auth.uid()` inside almost every policy. None of that is available
-- in a CI container, and without it the replay fails on line one for reasons
-- that have nothing to do with whether the schema is correct.
--
-- These stubs exist only so the real SQL parses, plans, and applies. They are
-- deliberately the thinnest possible shapes - `auth.uid()` returning null is
-- fine, because the point of the replay is "does this schema build", not
-- "does this policy admit the right rows". RLS behaviour is covered
-- separately by scripts/rls-smoke-test.js against a real project.
--
-- Never run this against a Supabase database. It would shadow the real ones.

-- Roles that policies are granted to. Supabase creates these; Postgres does not.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------------
create schema if not exists auth;

-- `profiles.id` has a foreign key to this, and schema.sql hangs the
-- handle_new_user() trigger off it, so it needs to be a real table.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- The real implementations read the request's JWT claims. Under replay there
-- is no request, so these return null / the empty string - enough for a policy
-- to compile and for a trigger body to be valid.
create or replace function auth.uid() returns uuid as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ language sql stable;

create or replace function auth.role() returns text as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$ language sql stable;

-- ---------------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz default now()
);

-- Only the columns this repo's policies actually reference: bucket_id and
-- name (which the job-photos policies split_part to recover a job id from).
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;
