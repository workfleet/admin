import { supabase } from './supabaseClient';

// The Deactivate / Reactivate buttons (Staff list and a person's own page).
// Goes through the server rather than updating profiles directly, because
// deactivating also has to cut off their sign-in - otherwise a phone that
// stayed logged in keeps the app. See app/api/admin/cleaners/[id]/active.
//
// Resolves to { active, message, ok }: `active` is the account's state now
// (null if unknown), `message` what to tell the admin.
export async function setStaffActive(id, active) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/admin/cleaners/${id}/active`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ active }),
  }).catch(() => null);
  const body = res ? await res.json().catch(() => ({})) : {};
  const now = typeof body.active === 'boolean' ? body.active : null;

  if (res?.ok) {
    return { ok: true, active: now, message: active ? 'Account reactivated.' : 'Account deactivated - they are signed out of the app.' };
  }
  if (now !== null) {
    // The switch flipped but their sign-in did not follow.
    return {
      ok: false,
      active: now,
      message: active
        ? 'Reactivated, but their login is still blocked - press Reactivate again.'
        : 'Deactivated, but their login could not be cut off - press Deactivate again.',
    };
  }
  return { ok: false, active: null, message: 'Could not update this account.' };
}
