-- supabase-js's .upsert() always requests the affected row back
-- (Prefer: return=representation), which under RLS also requires the
-- caller to be able to SELECT the row it just wrote - the existing
-- select policy (admin/supervisor only) silently failed every cleaner's
-- heartbeat write with "new row violates row-level security policy",
-- found via live testing rather than assumption. Adding a second
-- permissive select policy for "your own row" fixes this while cleaners
-- still can't see anyone else's presence - the existing admin/supervisor
-- policy still gates visibility into the full list.
create policy "user_presence: self select" on user_presence
  for select using (profile_id = auth.uid());
