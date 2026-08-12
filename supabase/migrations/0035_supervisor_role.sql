-- New "supervisor" role: office staff who can run day-to-day operations
-- (rota, clients, requests, templates, messages, reports) like an
-- admin, but can't manage other staff accounts (onboarding, adding or
-- deactivating cleaners/supervisors, adjusting holiday allowances) or
-- self-promote - those stay gated to is_admin() only, unchanged below.
--
-- Payroll hours on the Dashboard are hidden from supervisors at the UI
-- layer (app/admin/page.js) rather than here - the underlying jobs/
-- job_assignments data has to stay readable for them to actually run
-- the rota, so there's no clean RLS split between "which jobs are
-- scheduled" and "how many hours that adds up to" without breaking
-- their core rota access.

alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'supervisor', 'cleaner', 'client'));

create or replace function is_admin_or_supervisor() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'supervisor')
  );
$$ language sql security definer stable;

-- Widen the staff directory (0021) and team-chat auto-join (0021) to
-- include supervisors, so cleaners/supervisors can resolve each other's
-- names and new supervisor accounts land in Team Chat automatically.
create or replace function is_staff() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role in ('admin', 'supervisor', 'cleaner')
  );
$$ language sql security definer stable;

create or replace function add_to_team_chat() returns trigger as $$
declare
  team_chat_id uuid;
begin
  if new.role in ('admin', 'supervisor', 'cleaner') then
    select id into team_chat_id from conversations where type = 'group' limit 1;
    if team_chat_id is not null then
      insert into conversation_participants (conversation_id, profile_id)
      values (team_chat_id, new.id)
      on conflict (conversation_id, profile_id) do nothing;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

-- ---- Operational tables: admin -> admin or supervisor ----

drop policy if exists "clients: admin all" on clients;
create policy "clients: admin all" on clients for all using (is_admin_or_supervisor());

drop policy if exists "properties: admin all" on properties;
create policy "properties: admin all" on properties for all using (is_admin_or_supervisor());

drop policy if exists "jobs: admin all" on jobs;
create policy "jobs: admin all" on jobs for all using (is_admin_or_supervisor());

drop policy if exists "tasks: admin all" on tasks;
create policy "tasks: admin all" on tasks for all using (is_admin_or_supervisor());

drop policy if exists "checkins: admin all" on checkins;
create policy "checkins: admin all" on checkins for all using (is_admin_or_supervisor());

drop policy if exists "photos: admin all" on photos;
create policy "photos: admin all" on photos for all using (is_admin_or_supervisor());

drop policy if exists "job_reports: admin all" on job_reports;
create policy "job_reports: admin all" on job_reports for all using (is_admin_or_supervisor());

drop policy if exists "staff_requests: admin all" on staff_requests;
create policy "staff_requests: admin all" on staff_requests for all using (is_admin_or_supervisor());

drop policy if exists "client_call_logs: admin all" on client_call_logs;
create policy "client_call_logs: admin all" on client_call_logs for all using (is_admin_or_supervisor());

drop policy if exists "client_messages: admin all" on client_messages;
create policy "client_messages: admin all" on client_messages for all using (is_admin_or_supervisor());

drop policy if exists "time_off_requests: admin all" on time_off_requests;
create policy "time_off_requests: admin all" on time_off_requests for all using (is_admin_or_supervisor());

drop policy if exists "job_assignments: admin all" on job_assignments;
create policy "job_assignments: admin all" on job_assignments for all using (is_admin_or_supervisor());

drop policy if exists "job_series: admin all" on job_series;
create policy "job_series: admin all" on job_series for all using (is_admin_or_supervisor());

drop policy if exists "job_templates: admin all" on job_templates;
create policy "job_templates: admin all" on job_templates for all using (is_admin_or_supervisor());

drop policy if exists "job_template_items: admin all" on job_template_items;
create policy "job_template_items: admin all" on job_template_items for all using (is_admin_or_supervisor());

drop policy if exists "time_extension_requests: admin all" on time_extension_requests;
create policy "time_extension_requests: admin all" on time_extension_requests for all using (is_admin_or_supervisor());

drop policy if exists "job-photos: admin all" on storage.objects;
create policy "job-photos: admin all" on storage.objects
  for all to authenticated
  using (bucket_id = 'job-photos' and is_admin_or_supervisor())
  with check (bucket_id = 'job-photos' and is_admin_or_supervisor());

-- ---- Team chat: widen the admin-oversight OR-clauses too ----

drop policy if exists "conversations: participant or admin select" on conversations;
create policy "conversations: participant or admin select" on conversations
  for select using (is_conversation_participant(id) or is_admin_or_supervisor());

drop policy if exists "conversations: admin insert" on conversations;
create policy "conversations: admin insert" on conversations
  for insert with check (is_admin_or_supervisor());

drop policy if exists "conversation_participants: participant or admin select" on conversation_participants;
create policy "conversation_participants: participant or admin select" on conversation_participants
  for select using (is_conversation_participant(conversation_id) or is_admin_or_supervisor());

drop policy if exists "conversation_participants: admin insert" on conversation_participants;
create policy "conversation_participants: admin insert" on conversation_participants
  for insert with check (is_admin_or_supervisor());

drop policy if exists "chat_messages: participant or admin select" on chat_messages;
create policy "chat_messages: participant or admin select" on chat_messages
  for select using (is_conversation_participant(conversation_id) or is_admin_or_supervisor());

-- ---- Deliberately left untouched (full admin only): ----
-- "profiles: admin update" (0009), "staff_invites: admin all" (0005),
-- "staff_onboarding_submissions: admin all" (0005), the staff-documents
-- storage admin policy (0006), and prevent_self_privilege_escalation()
-- (0010/0023/0024) - all still call is_admin() directly, unchanged.
