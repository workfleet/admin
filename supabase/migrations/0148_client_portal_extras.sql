-- Client portal extras, 2026-11-18:
--   1. Supplies running low and requests for extra work, as client requests
--      (0057/0147) that name a site.
--   2. Quotes a client can see and accept or decline in the portal.
--   3. A compliance pack: company documents shown to every client.
--   4. "Your cleaner": first name, photo (with the cleaner's agreement) and
--      whether they hold an in-date DBS check, on the client's visit.
--
-- Proof of service needs nothing new - it reads visits, check-ins and
-- checklists the client can already see.

-- ---------------------------------------------------------------------------
-- 1. Supplies and extra work
-- ---------------------------------------------------------------------------

alter table client_requests drop constraint if exists client_requests_kind_check;
alter table client_requests
  add constraint client_requests_kind_check check (kind in ('request', 'problem', 'supplies', 'extra_work'));

alter table client_requests
  add column if not exists property_id uuid references properties(id) on delete set null,
  add column if not exists items text[] not null default '{}' check (cardinality(items) <= 30),
  add column if not exists preferred_date date;

-- Same as 0147, plus: a named site must be one of the client's own.
drop policy if exists "client_requests: client insert own" on client_requests;
create policy "client_requests: client insert own" on client_requests
  for insert with check (
    client_requests.client_id in (select pr.client_id from profiles pr where pr.id = auth.uid())
    and (
      client_requests.job_id is null
      or exists (
        select 1 from jobs j join properties p on p.id = j.property_id
        where j.id = client_requests.job_id and p.client_id = client_requests.client_id
      )
    )
    and (
      client_requests.property_id is null
      or exists (
        select 1 from properties p
        where p.id = client_requests.property_id and p.client_id = client_requests.client_id
      )
    )
    and not exists (
      select 1 from unnest(client_requests.photo_paths) as path
      where path not like client_requests.client_id::text || '/%'
    )
  );

create or replace function notify_admins_on_client_request() returns trigger as $$
declare
  client_name text;
  site text;
  visit text;
  msg text;
begin
  select name into client_name from clients where id = new.client_id;
  client_name := coalesce(client_name, 'A client');
  select address into site from properties where id = new.property_id;

  if new.kind = 'problem' then
    select p.address || ' on ' || to_char(j.scheduled_at at time zone 'Europe/London', 'Dy DD Mon')
      into visit
      from jobs j join properties p on p.id = j.property_id
      where j.id = new.job_id;
    msg := client_name || ' reported a problem with ' || coalesce(visit, 'a visit') || ': ' || left(new.description, 100);
  elsif new.kind = 'supplies' then
    msg := client_name || ': supplies running low at ' || coalesce(site, 'their site') || ' - '
      || left(coalesce(nullif(array_to_string(new.items, ', '), ''), new.description), 120);
  elsif new.kind = 'extra_work' then
    msg := client_name || ' asked for extra work at ' || coalesce(site, 'their site') || ': ' || left(new.description, 100);
  else
    msg := client_name || ' sent a request: ' || left(new.description, 100);
  end if;

  insert into notifications (user_id, message)
  select id, msg from profiles where role = 'admin';

  return new;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function notify_admins_on_client_request() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Quotes in the portal
-- ---------------------------------------------------------------------------

-- Which client request a quote answers, so sending it can close the request.
alter table quotes
  add column if not exists client_request_id uuid references client_requests(id) on delete set null;

-- Clients get no row access to quotes: a quote row also holds the
-- calculator's costs and margin. These two functions hand over only what
-- the client needs, for its own quotes that have been sent.
create or replace function client_quotes()
returns table (
  id uuid, description text, price numeric, price_period text, status text,
  valid_until date, created_at timestamptz, decided_at timestamptz
) as $$
  select q.id, q.description, q.price, q.price_period, q.status,
         q.valid_until, q.created_at, q.decided_at
  from quotes q
  where q.client_id = (select pr.client_id from profiles pr where pr.id = auth.uid() and pr.role = 'client' and pr.active is not false)
    and q.status in ('sent', 'accepted', 'declined')
    and q.archived_at is null
  order by q.created_at desc;
$$ language sql stable security definer set search_path = public;

revoke execute on function client_quotes() from public, anon;
grant execute on function client_quotes() to authenticated;

create or replace function respond_to_quote(p_quote_id uuid, p_accept boolean)
returns text as $$
declare
  me_client uuid;
  q record;
  client_name text;
begin
  select pr.client_id into me_client from profiles pr
  where pr.id = auth.uid() and pr.role = 'client' and pr.active is not false;
  if me_client is null then return 'not_allowed'; end if;

  select * into q from quotes where id = p_quote_id and client_id = me_client and archived_at is null;
  if not found then return 'not_found'; end if;
  if q.status <> 'sent' then return 'already_decided'; end if;
  if q.valid_until is not null and q.valid_until < (now() at time zone 'Europe/London')::date then return 'expired'; end if;

  update quotes
    set status = case when p_accept then 'accepted' else 'declined' end,
        decided_at = now()
    where id = p_quote_id;

  select name into client_name from clients where id = me_client;
  insert into notifications (user_id, message)
  select id, coalesce(client_name, 'A client') || case when p_accept then ' accepted' else ' declined' end
    || ' your quote: ' || left(q.description, 80)
  from profiles where role = 'admin';

  return case when p_accept then 'accepted' else 'declined' end;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function respond_to_quote(uuid, boolean) from public, anon;
grant execute on function respond_to_quote(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Compliance pack
-- ---------------------------------------------------------------------------

-- A document in the office library (client_id null) that every client can
-- also see: insurance certificate, risk assessments, COSHH sheets.
alter table company_documents
  add column if not exists for_all_clients boolean not null default false;

drop policy if exists "company_documents: every client reads the pack" on company_documents;
create policy "company_documents: every client reads the pack" on company_documents
  for select using (
    for_all_clients and client_id is null
    and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'client' and pr.active is not false)
  );

drop policy if exists "company-documents: every client reads the pack" on storage.objects;
create policy "company-documents: every client reads the pack" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-documents'
    and exists (select 1 from company_documents cd where cd.storage_path = name and cd.for_all_clients and cd.client_id is null)
    and exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'client' and pr.active is not false)
  );

-- ---------------------------------------------------------------------------
-- 4. Your cleaner
-- ---------------------------------------------------------------------------

-- photo_visible_to_clients records that the cleaner agreed to clients
-- seeing their photo; without it the photo stays office-only.
alter table profiles
  add column if not exists photo_path text,
  add column if not exists photo_visible_to_clients boolean not null default false;

insert into storage.buckets (id, name, public) values ('staff-photos', 'staff-photos', false)
on conflict (id) do nothing;

drop policy if exists "staff-photos: office manage" on storage.objects;
create policy "staff-photos: office manage" on storage.objects
  for all to authenticated
  using (bucket_id = 'staff-photos' and is_admin_or_supervisor())
  with check (bucket_id = 'staff-photos' and is_admin_or_supervisor());

-- The cleaner's own photo, and a client's cleaners' photos where they
-- agreed: only someone booked at one of that client's properties.
drop policy if exists "staff-photos: own or a client's agreed cleaner" on storage.objects;
create policy "staff-photos: own or a client's agreed cleaner" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'staff-photos'
    and (
      split_part(name, '/', 1) = auth.uid()::text
      or exists (
        select 1
        from profiles cleaner
        join job_assignments ja on ja.cleaner_id = cleaner.id
        join jobs j on j.id = ja.job_id
        join properties p on p.id = j.property_id
        join profiles me on me.id = auth.uid() and me.role = 'client' and me.client_id = p.client_id
        where cleaner.id::text = split_part(name, '/', 1)
          and cleaner.photo_visible_to_clients
          and cleaner.photo_path = name
      )
    )
  );

-- First name, agreed photo and DBS status for each cleaner on one of the
-- caller's own visits. Certifications stay office-only; only the yes/no
-- leaves the function.
create or replace function client_visit_cleaners(p_job_id uuid)
returns table (cleaner_id uuid, first_name text, photo_path text, dbs_checked boolean) as $$
  select
    c.id,
    split_part(trim(coalesce(c.full_name, '')), ' ', 1),
    case when c.photo_visible_to_clients then c.photo_path end,
    exists (
      select 1 from staff_certifications sc
      where sc.staff_id = c.id
        and sc.name ilike '%dbs%'
        and (sc.expiry_date is null or sc.expiry_date >= (now() at time zone 'Europe/London')::date)
    )
  from jobs j
  join properties p on p.id = j.property_id
  join profiles me on me.id = auth.uid() and me.role = 'client' and me.client_id = p.client_id
  join job_assignments ja on ja.job_id = j.id
  join profiles c on c.id = ja.cleaner_id
  where j.id = p_job_id;
$$ language sql stable security definer set search_path = public;

revoke execute on function client_visit_cleaners(uuid) from public, anon;
grant execute on function client_visit_cleaners(uuid) to authenticated;
