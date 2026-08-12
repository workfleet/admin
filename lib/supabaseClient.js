import { createClient } from '@supabase/supabase-js';

// Falls back to placeholders when the real env vars aren't set, rather
// than throwing here - createClient() only validates its arguments, it
// doesn't connect. This file is imported by nearly every page, so a
// missing var previously would have crashed `next build` entirely
// instead of just failing requests at runtime.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
