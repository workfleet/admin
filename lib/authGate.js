import { supabase } from './supabaseClient';

// Where the last confirmed sign-in is remembered, so the app can still be
// used offline. When the phone has no signal, supabase.auth.getSession()
// cannot refresh an hour-old token and hands back null - which every gate
// below used to read as "not signed in" and bounce the cleaner to a login
// page that cannot work offline either. On site, mid-shift, that is the worst
// possible moment to be locked out.
//
// So a successful sign-in records the user id and role here. When a later
// check fails AND the phone is offline, that record stands in for the network
// the gate could not reach. It is never trusted while online: every branch
// below is guarded by isOffline(), so the online path is exactly as it was.
// Nothing here grants any access on the server - RLS still decides every
// write when the queue finally syncs with a real token - it only keeps a
// cleaner who is genuinely signed in inside the app when the signal drops.
const REMEMBER_KEY = 'wf.session.v1';

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function safeStorage(storage) {
  if (storage) return storage;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function rememberSession(userId, role, storage) {
  const store = safeStorage(storage);
  if (!store || !userId) return;
  // A call that does not know the role (getSessionWithRetry only has the
  // session) must refresh the user id without wiping the role a fuller call
  // stored earlier. Only an explicit role replaces it.
  let keptRole = role === undefined ? null : role;
  if (role === undefined) {
    const existing = recallSession(store);
    if (existing && existing.userId === userId) keptRole = existing.role ?? null;
  }
  try {
    store.setItem(REMEMBER_KEY, JSON.stringify({ userId, role: keptRole, at: Date.now() }));
  } catch {
    // Storage full or blocked. Offline resilience is a convenience, not worth
    // throwing over.
  }
}

export function recallSession(storage) {
  const store = safeStorage(storage);
  if (!store) return null;
  try {
    const parsed = JSON.parse(store.getItem(REMEMBER_KEY) || 'null');
    if (!parsed || !parsed.userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearRememberedSession(storage) {
  const store = safeStorage(storage);
  if (!store) return;
  try {
    store.removeItem(REMEMBER_KEY);
  } catch {
    // Nothing to do.
  }
}

// A session shape good enough for the offline gates: the user id is what the
// clock queue and the job page read, and `offline` marks it as one that
// carries no usable access token, so a caller can tell it apart from a live
// one if it ever needs to.
function offlineSession(userId) {
  return { user: { id: userId }, access_token: null, offline: true };
}

// Session + role lookup shared by every portal's access gate (login page,
// admin/cleaner/client layouts). getSession() can return a valid session from
// memory a few seconds before its access token is fresh enough for a
// subsequent query to actually succeed - the profiles fetch below then 401s,
// and every call site used to treat that fetch *error* identically to "this
// profile doesn't have the right role", silently bouncing a legitimately
// signed-in user back to login with no visible error. One retry after a short
// pause absorbs that race; only a second consecutive failure is reported as a
// real error rather than guessed away.
export async function getSessionAndProfile() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      // Offline with an expired token: getSession could not refresh. If this
      // device has a remembered sign-in, keep them in the app on it rather
      // than sending them to a login page the network can't reach.
      const remembered = isOffline() ? recallSession() : null;
      if (remembered) {
        return { session: offlineSession(remembered.userId), profile: { role: remembered.role, active: true }, error: null, offline: true };
      }
      return { session: null, profile: null, error: null };
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role, active')
      .eq('id', session.user.id)
      .single();

    if (!error) {
      // Remember this good sign-in so a later offline load has a role to fall
      // back on.
      rememberSession(session.user.id, profile?.role);
      return { session, profile, error: null };
    }

    // The token is valid but the profile lookup failed. Offline, that is just
    // no signal, not a missing role - fall back to the remembered role for
    // this same user rather than showing an error screen.
    if (isOffline()) {
      const remembered = recallSession();
      if (remembered && remembered.userId === session.user.id) {
        return { session, profile: { role: remembered.role, active: true }, error: null, offline: true };
      }
    }

    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const { data: { session } } = await supabase.auth.getSession();
  return { session, profile: null, error: 'profile_fetch_failed' };
}

// Every portal layout already gates access with getSessionAndProfile() above,
// but individual pages then each re-check the session a second time on their
// own mount (to grab a token for a query, or as a second gate) via a raw
// supabase.auth.getSession() with no retry - so any of the same "not hydrated
// yet" races that motivated the retry above can still silently bounce an
// already-logged-in user back to login from deep inside a portal, with no
// error shown. Use this in place of the raw call wherever a page does that
// same check.
export async function getSessionWithRetry() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      rememberSession(session.user.id, undefined);
      return session;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Offline with an expired token: hand back the remembered user so a page
  // shows its own honest "no signal" state instead of bouncing to login.
  if (isOffline()) {
    const remembered = recallSession();
    if (remembered) return offlineSession(remembered.userId);
  }
  return null;
}
