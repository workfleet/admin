import { supabase } from './supabaseClient';

// Session + role lookup shared by every portal's access gate (login
// page, admin/cleaner/client layouts). getSession() can return a valid
// session from memory a few seconds before its access token is fresh
// enough for a subsequent query to actually succeed - the profiles
// fetch below then 401s, and every call site used to treat that
// fetch *error* identically to "this profile doesn't have the right
// role", silently bouncing a legitimately signed-in user back to
// login with no visible error. One retry after a short pause absorbs
// that race; only a second consecutive failure is reported as a real
// error rather than guessed away.
export async function getSessionAndProfile() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { session: null, profile: null, error: null };

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role, active')
      .eq('id', session.user.id)
      .single();

    if (!error) return { session, profile, error: null };
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const { data: { session } } = await supabase.auth.getSession();
  return { session, profile: null, error: 'profile_fetch_failed' };
}

// Every portal layout already gates access with getSessionAndProfile()
// above, but individual pages then each re-check the session a second
// time on their own mount (to grab a token for a query, or as a second
// gate) via a raw supabase.auth.getSession() with no retry - so any of
// the same "not hydrated yet" races that motivated the retry above can
// still silently bounce an already-logged-in user back to login from
// deep inside a portal, with no error shown. Use this in place of the
// raw call wherever a page does that same check.
export async function getSessionWithRetry() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return session;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}
