import { supabase } from './supabaseClient';

// Fire-and-forget: a failed email should never block the action that
// triggered it (job assignment, resolving a request, sending a message).
export async function notify(payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(payload),
    });
  } catch {
    // best-effort only
  }
}
