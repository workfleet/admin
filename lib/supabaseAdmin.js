import { createClient } from '@supabase/supabase-js';

// Server-only: uses the service role key, which bypasses RLS entirely.
// Never import this file from a 'use client' component — it must only run
// in Route Handlers / Server Components, since the key can't reach the browser.
//
// Falls back to placeholders when the real env vars aren't set, rather
// than throwing here - createClient() only validates its arguments, it
// doesn't connect. Next.js imports every route module during `next build`
// to analyze it, so a missing var previously crashed the entire build
// instead of just failing the one request that actually needed it.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-role-key',
  { auth: { autoRefreshToken: false, persistSession: false } }
);
