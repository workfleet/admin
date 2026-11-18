-- "Something wasn't right" on a past visit, from the client portal.
--
-- Complaints used to arrive as a general request or a message, with nothing
-- saying which visit or cleaner they were about. A problem report is a
-- client request (0057) that names the visit and can carry photos, so it
-- lands in the same Client requests list in admin with the same
-- open/resolved flow and resolution note the client sees.
--
-- kind 'request' is everything that came before; 'problem' is a report
-- about one visit.

alter table client_requests
  add column if not exists kind text not null default 'request'
    check (kind in ('request', 'problem')),
  add column if not exists job_id uuid references jobs(id) on delete set null,
  add column if not exists photo_paths text[] not null default '{}'
    check (cardinality(photo_paths) <= 6);

create index if not exists client_requests_job_id_idx on client_requests(job_id) where job_id is not null;

-- A client may only name a visit at one of its own properties, and only
-- attach photos from its own folder (below).
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
    and not exists (
      select 1 from unnest(client_requests.photo_paths) as path
      where path not like client_requests.client_id::text || '/%'
    )
  );

-- The office alert says what it is and which visit.
create or replace function notify_admins_on_client_request() returns trigger as $$
declare
  client_name text;
  visit text;
  msg text;
begin
  select name into client_name from clients where id = new.client_id;

  if new.kind = 'problem' then
    select p.address || ' on ' || to_char(j.scheduled_at at time zone 'Europe/London', 'Dy DD Mon')
      into visit
      from jobs j join properties p on p.id = j.property_id
      where j.id = new.job_id;
    msg := coalesce(client_name, 'A client') || ' reported a problem with '
      || coalesce(visit, 'a visit') || ': ' || left(new.description, 100);
  else
    msg := coalesce(client_name, 'A client') || ' sent a request: ' || left(new.description, 100);
  end if;

  insert into notifications (user_id, message)
  select id, msg from profiles where role = 'admin';

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- A trigger function, never meant to be called directly.
revoke execute on function notify_admins_on_client_request() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Photos
-- ---------------------------------------------------------------------------

-- Private. Files sit under the client's id, so the path says whose they are.
insert into storage.buckets (id, name, public) values ('client-problem-photos', 'client-problem-photos', false)
on conflict (id) do nothing;

drop policy if exists "client-problem-photos: client upload own" on storage.objects;
create policy "client-problem-photos: client upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-problem-photos'
    and split_part(name, '/', 1) in (
      select pr.client_id::text from profiles pr
      where pr.id = auth.uid() and pr.role = 'client' and pr.active is not false and pr.client_id is not null
    )
  );

drop policy if exists "client-problem-photos: own client or office read" on storage.objects;
create policy "client-problem-photos: own client or office read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-problem-photos'
    and (
      is_admin_or_supervisor()
      or split_part(name, '/', 1) in (
        select pr.client_id::text from profiles pr
        where pr.id = auth.uid() and pr.role = 'client' and pr.client_id is not null
      )
    )
  );

drop policy if exists "client-problem-photos: admin delete" on storage.objects;
create policy "client-problem-photos: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'client-problem-photos' and is_admin());
