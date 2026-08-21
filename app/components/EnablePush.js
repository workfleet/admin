'use client';

import { useEffect, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useToast } from './ToastProvider';

// Converts the VAPID public key (base64url) to the Uint8Array shape
// pushManager.subscribe() expects for applicationServerKey.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Bell icon in the admin topbar - lets admin/supervisor opt this device
// in to push notifications for emergency alerts. Deliberately a manual
// opt-in rather than auto-subscribing on login: browsers require a user
// gesture before requesting notification permission, and silently
// prompting on every login would just train people to dismiss it.
export default function EnablePush({ iconColor = 'var(--muted)' }) {
  const toast = useToast();
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupported('serviceWorker' in navigator && 'PushManager' in window && Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY));
    checkExistingSubscription();
  }, []);

  const checkExistingSubscription = async () => {
    if (!('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg) return;
    const existing = await reg.pushManager.getSubscription();
    setSubscribed(Boolean(existing));
  };

  const enable = async () => {
    if (subscribed || busy) return;
    setBusy(true);

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast.error('Notifications were not allowed - you can enable them in your browser settings.');
        setBusy(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
      });

      const { data: { session } } = await supabase.auth.getSession();
      const json = sub.toJSON();
      const { error } = await supabase.from('push_subscriptions').upsert({
        user_id: session.user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      }, { onConflict: 'endpoint' });

      if (error) throw error;

      setSubscribed(true);
      toast.success('Emergency alerts will now push to this device.');
    } catch {
      toast.error('Could not enable push notifications on this device.');
    } finally {
      setBusy(false);
    }
  };

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={enable}
      disabled={busy || subscribed}
      aria-label={subscribed ? 'Push notifications enabled' : 'Enable push notifications for emergency alerts'}
      title={subscribed ? 'Push notifications enabled on this device' : 'Enable push notifications for emergency alerts'}
      style={{ background: 'transparent', border: 'none', padding: 6, cursor: subscribed ? 'default' : 'pointer', display: 'flex', alignItems: 'center' }}
    >
      {subscribed ? <BellRing size={20} color="var(--wf-verified)" /> : <Bell size={20} color={iconColor} />}
    </button>
  );
}
