-- Send the night worker health questionnaire to anyone (follows 0143).
--
-- 0143 asks the people on night_workers. The office also wants to send it
-- to any member of staff when needed - someone about to start nights, or
-- covering a night shift - without listing them as a night worker.
--
-- A request is one row per person: sending again moves requested_at on.
-- Their Home tab asks them until they send a questionnaire dated after it.
-- Sending also puts it in their notifications (and so on their phone,
-- through the pending-push sweep).
--
-- Who has been asked says nothing about anyone's health, but it is kept to
-- the same people as the answers: the person themselves and admins.
-- requested_by is a plain uuid: one FK to profiles per table (0094/0095).

create table if not exists night_health_requests (
  profile_id uuid primary key references profiles(id) on delete cascade,
  requested_at timestamptz not null default now(),
  requested_by uuid
);

alter table night_health_requests enable row level security;

drop policy if exists "night_health_requests: own or admin read" on night_health_requests;
create policy "night_health_requests: own or admin read" on night_health_requests
  for select using (profile_id = auth.uid() or is_admin());

drop policy if exists "night_health_requests: admin send" on night_health_requests;
create policy "night_health_requests: admin send" on night_health_requests
  for insert with check (is_admin());

drop policy if exists "night_health_requests: admin send again" on night_health_requests;
create policy "night_health_requests: admin send again" on night_health_requests
  for update using (is_admin()) with check (is_admin());

drop policy if exists "night_health_requests: admin cancel" on night_health_requests;
create policy "night_health_requests: admin cancel" on night_health_requests
  for delete using (is_admin());

-- The time and sender are the server's, and each send tells the person.
create or replace function night_health_request_stamp() returns trigger as $$
begin
  new.requested_at := now();
  new.requested_by := auth.uid();
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists night_health_request_stamp on night_health_requests;
create trigger night_health_request_stamp before insert or update on night_health_requests
  for each row execute function night_health_request_stamp();

create or replace function night_health_request_notify() returns trigger as $$
begin
  insert into notifications (user_id, message)
  values (new.profile_id,
    'The office has asked you to fill in the night worker health questionnaire. It''s free and confidential - open it from your Home tab.');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists night_health_request_notify on night_health_requests;
create trigger night_health_request_notify after insert or update on night_health_requests
  for each row execute function night_health_request_notify();

revoke execute on function night_health_request_stamp() from public, anon, authenticated;
revoke execute on function night_health_request_notify() from public, anon, authenticated;
revoke all on night_health_requests from anon;
