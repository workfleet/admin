import { supabase } from './supabaseClient';
import { clearRememberedSession } from './authGate';

// Presence normally ages out passively (a stale heartbeat just falls out of
// PresenceIndicator's online window after ~60s) - fine while someone's still
// signed in, but confusing right after a deliberate sign-out, where the
// "who's online" panel would keep showing them as online for up to a minute.
// Backdating their own heartbeat row (allowed by the existing self-update
// RLS policy) pushes them out of that window immediately, no new policy needed.
export async function signOutAndClearPresence() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await supabase
      .from('user_presence')
      .update({ last_seen_at: new Date(0).toISOString() })
      .eq('profile_id', session.user.id);
  }
  await supabase.auth.signOut();

  // Otherwise the offline fallback (authGate) would keep letting this device
  // back into the app as the person who just signed out - the exact problem
  // on a shared phone.
  clearRememberedSession();
}
