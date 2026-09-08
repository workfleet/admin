-- Every read of profiles on the live project failed with 42P17, "infinite
-- recursion detected in policy for relation profiles" (found 2026-09-08,
-- surfacing as "Couldn't load your account" for everyone at the login gate,
-- because getSessionAndProfile() reads profiles first). Reads of clients
-- failed the same way, because "clients: client self" looks up profiles.
--
-- pg_policies on the live project showed a fifth policy on profiles:
-- "profiles: client sees assigned cleaners", from 0090, a select whose USING
-- clause reads job_assignments and jobs. Those tables carry their own
-- policies, and evaluating them re-enters profiles, which evaluates this
-- policy again. The other four policies test auth.uid() or a SECURITY
-- DEFINER helper and cannot loop.
--
-- The policy is doing a real job: the client portal shows cleaner names via
-- job_assignments(profiles(full_name)), and without some policy granting a
-- client those rows the names come back null. So it stays, rewritten the way
-- 0002 fixed the same loop between jobs and properties: the cross-table
-- lookup goes into a definer function, which runs as the owner and so does
-- not re-enter the profiles policies.
--
-- Everything on profiles is dropped and recreated so the live table ends up
-- with exactly these five, whatever else was ever added by hand.

create or replace function client_assigned_cleaner_ids() returns setof uuid as $$
  select ja.cleaner_id
  from job_assignments ja
  join jobs j on j.id = ja.job_id
  join properties p on p.id = j.property_id
  join profiles pr on pr.client_id = p.client_id
  where pr.id = auth.uid()
$$ language sql security definer stable set search_path = public;

-- A policy calls this for every reader of profiles, so every role that can
-- read the table needs EXECUTE - anon included, as with is_admin() and the
-- other helpers. For anon auth.uid() is null and the set is empty.
revoke execute on function client_assigned_cleaner_ids() from public;
grant execute on function client_assigned_cleaner_ids() to anon, authenticated;

do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', p.policyname);
  end loop;
end $$;

-- schema.sql
create policy "profiles: self or admin" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "profiles: self update" on profiles
  for update using (id = auth.uid());

-- 0009
create policy "profiles: admin update" on profiles
  for update using (is_admin());

-- 0021
create policy "profiles: staff directory visible to staff" on profiles
  for select using (role in ('admin', 'cleaner') and is_staff());

-- 0090, without the loop.
create policy "profiles: client sees assigned cleaners" on profiles
  for select using (id in (select client_assigned_cleaner_ids()));
