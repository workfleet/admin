import { supabase } from './supabaseClient';

// Turning push on for this device, shared by the bell in the top bar
// (EnablePush) and the card on the cleaner home page (EnablePushCard) so the
// two can never disagree. Browser-only: call from effects and handlers.

const CHANGED = 'wf-push-changed';

// Converts the VAPID public key (base64url) to the Uint8Array shape
// pushManager.subscribe() expects for applicationServerKey.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
}

// 'granted' | 'denied' | 'default', or null where there is no Notification
// API at all (iPhone outside the Home Screen app).
export function notificationPermission() {
  return typeof Notification === 'undefined' ? null : Notification.permission;
}

async function saveSubscription(sub) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { error: new Error('signed out') };
  const json = sub.toJSON();
  return supabase.from('push_subscriptions').upsert({
    user_id: session.user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  }, { onConflict: 'endpoint' });
}

// Whether this device already pushes. A phone can hold a subscription the
// server has since lost (deleted as gone, or saved under nobody when the
// first save failed), which left the bell green while nothing arrived - so
// a live one is saved again, quietly, every time this is asked.
export async function hasPushSubscription() {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  // iPhone Safari in an ordinary browser tab registers the service worker
  // but has no pushManager on it - push there exists only once the app is
  // on the Home Screen. Reading it anyway threw on every page load
  // (Sentry, 2026-09-09) and told nobody anything.
  if (!reg || !reg.pushManager) return false;
  try {
    const existing = await reg.pushManager.getSubscription();
    if (!existing) return false;
    if (notificationPermission() === 'granted') saveSubscription(existing).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

// Returns 'ok', 'denied' (they said no, or it is blocked in settings) or
// 'failed'. Must run from a tap: browsers refuse the permission prompt
// otherwise.
export async function subscribeToPush() {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
    });

    const { error } = await saveSubscription(sub);
    if (error) return 'failed';

    window.dispatchEvent(new Event(CHANGED));
    return 'ok';
  } catch {
    return 'failed';
  }
}

// Told when either the bell or the card turns push on, so the other one
// catches up without a reload.
export function onPushChanged(fn) {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}
