import { createClient } from '@supabase/supabase-js';

// Server-only: uses the service role key, which bypasses RLS entirely.
// Never import this file from a 'use client' component — it must only run
// in Route Handlers / Server Components, since the key can't reach the browser.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
