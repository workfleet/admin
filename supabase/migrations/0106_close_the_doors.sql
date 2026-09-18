-- Three doors the 2026-09-18 audit found open, closed together.
--
-- 1. A login could change which client it belongs to. "profiles: self
--    update" (0091) has no column restriction, and the guard trigger (0088)
--    checked only role and active. Every client-portal policy keys off
--    profiles.client_id, so a cleaner who set theirs to a client's id saw
--    and could write as that client. Now only an admin can change it.
create or replace function prevent_self_privilege_escalation() returns trigger as $$
begin
  if auth.uid() is not null and not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only an admin can change role';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only an admin can change active status';
    end if;
    if new.client_id is distinct from old.client_id then
      raise exception 'Only an admin can change which client an account belongs to';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- 2. Anyone who registered became an active cleaner. The app never offers
--    sign-up, but the auth service's sign-up endpoint is reachable with the
--    public key, and this trigger made every new auth user an active
--    cleaner. The switch that matters is "Allow new users to sign up" in
--    the Supabase Auth settings, which must be turned off in the dashboard;
--    this is the second lock. Accounts the office creates (the Cleaners
--    page and the onboarding link both go through the admin API) carry
--    created_by_office in app_metadata, which a self-signup cannot set, and
--    only those start active. Anyone else lands inactive, which blocks
--    login and every cleaner policy, and shows under Cleaners as former
--    staff where an admin can reactivate them if they were expected.
create or replace function handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    'cleaner',
    coalesce((new.raw_app_meta_data->>'created_by_office')::boolean, false)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- 3. Functions the public key could call. Supabase grants EXECUTE on every
--    new function to anon and authenticated explicitly, so "revoke from
--    public" alone (0096) changes nothing. apply_missed_shift_absences()
--    rewrites paid minutes and answered a probe with no session; the two
--    open_offer helpers handed back the job and property ids of live cover
--    offers. None of the three is called from the app or a policy: the
--    first runs inside admin_confirm_missed_shift() and
--    decide_missed_clockin_claim(), which as definer functions keep their
--    own right to call it.
revoke execute on function apply_missed_shift_absences(uuid) from public, anon, authenticated;
revoke execute on function open_offer_job_ids() from public, anon, authenticated;
revoke execute on function open_offer_property_ids() from public, anon, authenticated;

-- The rest refuse a non-office caller inside, but there is no reason for
-- them to answer the public key at all, and decide_missed_clockin_claim()
-- looked the row up before checking the caller, which told an anonymous
-- caller whether a claim id existed. Signed-in callers keep them, as 0089
-- did for decide_location_proposal().
revoke execute on function cancel_shift_offer(uuid) from public, anon;
revoke execute on function resume_auto_checkout(uuid) from public, anon;
revoke execute on function decide_missed_clockin_claim(uuid, text, text) from public, anon;
revoke execute on function admin_confirm_missed_shift(uuid, text) from public, anon;
revoke execute on function confirm_short_shift(uuid) from public, anon;
revoke execute on function correct_short_shift(uuid, int) from public, anon;
revoke execute on function close_payroll_period(date, date, text) from public, anon;
revoke execute on function payroll_close_review(date, date) from public, anon;
revoke execute on function payroll_period_lines_for(date, date) from public, anon;
revoke execute on function rank_cover_candidates(uuid) from public, anon;
grant execute on function cancel_shift_offer(uuid) to authenticated;
grant execute on function resume_auto_checkout(uuid) to authenticated;
grant execute on function decide_missed_clockin_claim(uuid, text, text) to authenticated;
grant execute on function admin_confirm_missed_shift(uuid, text) to authenticated;
grant execute on function confirm_short_shift(uuid) to authenticated;
grant execute on function correct_short_shift(uuid, int) to authenticated;
grant execute on function close_payroll_period(date, date, text) to authenticated;
grant execute on function payroll_close_review(date, date) to authenticated;
grant execute on function payroll_period_lines_for(date, date) to authenticated;
grant execute on function rank_cover_candidates(uuid) to authenticated;

-- And stop the pattern recurring: from here on a new function in public is
-- not callable by the public key unless a migration grants it. Nothing the
-- app does before sign-in calls a function (the login and onboarding pages
-- go through API routes), so nothing loses access. Functions that exist
-- today are unchanged by this; it applies to ones created later.
alter default privileges for role postgres in schema public revoke execute on functions from anon;
