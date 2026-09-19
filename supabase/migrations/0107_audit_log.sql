-- A change log for the rota, so "where did that job go?" has an answer.
--
-- On 2026-09-19 a cleaner's job vanished from her rota for that day, and
-- the database could not say when it went, who removed it, or how. A
-- deleted job takes its assignments, tasks and check-ins with it and leaves
-- nothing behind; the one clue was a bell notification from the day it was
-- added. This table records every insert, delete and rota-shaping update
-- on the tables that make up the rota, with who did it and which request
-- it arrived in, so the next time the answer is one query.
--
-- Each row is written by a trigger running as the table owner, so nothing
-- in the app can skip it, and only admins can read it. Nothing can edit or
-- delete a row through the API: there is no policy for it, and the writer
-- runs inside the trigger, not under the caller's role.

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  -- The login that made the change. Null when it came from the service key
  -- (a server route or a script) or from a scheduled database job.
  actor_id uuid,
  -- The JWT role the request carried: authenticated, service_role, anon.
  actor_role text,
  table_name text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  row_id uuid,
  -- One readable line, resolved at write time (addresses, names, times),
  -- because by the time anyone reads this the rows it names may be gone.
  summary text not null,
  old_row jsonb,
  new_row jsonb,
  -- Which request did it: PostgREST exposes the method and path of the
  -- call that opened the transaction. Everything a single click deletes
  -- shares one tx, so a series delete groups together and a cascade from
  -- a property or client delete is visible as such.
  request_method text,
  request_path text,
  tx bigint not null,
  cascade boolean not null default false
);

create index audit_log_at_idx on audit_log (at desc);
create index audit_log_row_idx on audit_log (row_id);
create index audit_log_tx_idx on audit_log (tx);

alter table audit_log enable row level security;

create policy "audit_log: admin read" on audit_log
  for select using (is_admin());

-- ---------------------------------------------------------------------------
-- Readable one-liners. Each takes the row as jsonb so the same function
-- serves inserts, updates and deletes, and each tolerates the rows it
-- refers to having already gone (a cascade delete reaches jobs after the
-- property is gone, and reaches assignments after the job is gone).
-- ---------------------------------------------------------------------------

create or replace function audit_describe_job(r jsonb) returns text as $$
  select coalesce(
    (select c.name || ' - ' || p.address
       from properties p left join clients c on c.id = p.client_id
       where p.id = (r->>'property_id')::uuid),
    'property ' || coalesce(r->>'property_id', '?'))
    || ' on ' || to_char((r->>'scheduled_at')::timestamptz at time zone 'Europe/London', 'Dy DD Mon YYYY HH24:MI')
    || coalesce(' (' || (r->>'duration_minutes') || ' min)', '')
    || coalesce(', ' || (r->>'status'), '')
    || case when r->>'series_id' is not null then ', in a recurring series' else '' end;
$$ language sql stable security definer set search_path = public;

create or replace function audit_describe_assignment(r jsonb) returns text as $$
  select coalesce((select full_name from profiles where id = (r->>'cleaner_id')::uuid), 'cleaner ' || coalesce(r->>'cleaner_id', '?'))
    || ' on '
    || coalesce((select audit_describe_job(to_jsonb(j)) from jobs j where j.id = (r->>'job_id')::uuid),
                'job ' || coalesce(r->>'job_id', '?') || ' (already deleted)');
$$ language sql stable security definer set search_path = public;

create or replace function audit_describe_property(r jsonb) returns text as $$
  select coalesce((select name from clients where id = (r->>'client_id')::uuid), 'client ' || coalesce(r->>'client_id', '?'))
    || ' - ' || coalesce(r->>'address', '?');
$$ language sql stable security definer set search_path = public;

create or replace function audit_describe_series(r jsonb) returns text as $$
  select coalesce((select audit_describe_property(to_jsonb(p)) from properties p where p.id = (r->>'property_id')::uuid),
                  'property ' || coalesce(r->>'property_id', '?'))
    || ', ' || coalesce(r->>'recurrence_type', '?')
    || case when (r->>'interval_count')::int > 1 then ' every ' || (r->>'interval_count') else '' end
    || coalesce(' (' || (r->>'duration_minutes') || ' min)', '');
$$ language sql stable security definer set search_path = public;

revoke execute on function audit_describe_job(jsonb) from public, anon, authenticated;
revoke execute on function audit_describe_assignment(jsonb) from public, anon, authenticated;
revoke execute on function audit_describe_property(jsonb) from public, anon, authenticated;
revoke execute on function audit_describe_series(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The writer. One function for every table; which describer to use comes
-- from the table name.
-- ---------------------------------------------------------------------------

create or replace function write_audit_log() returns trigger as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  row_data jsonb;
  line text;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  -- Updates are logged only when they change where or when a job is, or
  -- how long it runs. Status flips from check-ins, nudge stamps and review
  -- flags are the app's own bookkeeping and would drown the log.
  if tg_op = 'UPDATE' and tg_table_name = 'jobs' then
    if new.scheduled_at is not distinct from old.scheduled_at
       and new.property_id is not distinct from old.property_id
       and new.duration_minutes is not distinct from old.duration_minutes
       and new.series_id is not distinct from old.series_id then
      return new;
    end if;
  end if;

  line := case tg_table_name
    when 'jobs' then audit_describe_job(row_data)
    when 'job_assignments' then audit_describe_assignment(row_data)
    when 'properties' then audit_describe_property(row_data)
    when 'clients' then coalesce(row_data->>'name', '?')
    when 'job_series' then audit_describe_series(row_data)
    else row_data::text
  end;

  if tg_op = 'UPDATE' and tg_table_name = 'jobs' then
    line := line || ' (was '
      || to_char(old.scheduled_at at time zone 'Europe/London', 'Dy DD Mon YYYY HH24:MI')
      || coalesce(', ' || old.duration_minutes || ' min', '')
      || case when new.property_id is distinct from old.property_id then ', different property' else '' end
      || ')';
  end if;

  insert into audit_log (
    actor_id, actor_role, table_name, action, row_id, summary, old_row, new_row,
    request_method, request_path, tx, cascade
  ) values (
    auth.uid(),
    claims->>'role',
    tg_table_name,
    lower(tg_op),
    (row_data->>'id')::uuid,
    line,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    nullif(current_setting('request.method', true), ''),
    nullif(current_setting('request.path', true), ''),
    txid_current(),
    pg_trigger_depth() > 1
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- BEFORE, not AFTER, so a delete is described while the row's own
-- neighbours (its property, its job) are still there to be named. Within
-- a cascade the parent has already gone; the describers fall back to ids
-- and the shared tx ties the rows together.
create trigger audit_jobs
  before insert or update or delete on jobs
  for each row execute procedure write_audit_log();

create trigger audit_job_assignments
  before insert or delete on job_assignments
  for each row execute procedure write_audit_log();

create trigger audit_job_series
  before insert or delete on job_series
  for each row execute procedure write_audit_log();

create trigger audit_properties
  before delete on properties
  for each row execute procedure write_audit_log();

create trigger audit_clients
  before delete on clients
  for each row execute procedure write_audit_log();
