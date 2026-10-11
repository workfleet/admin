'use client';

import { useEffect, useState } from 'react';
import { Bell, BellRing } from 'lucide-react';
import { useToast } from './ToastProvider';
import { pushSupported, hasPushSubscription, subscribeToPush, onPushChanged } from '../../lib/pushSubscription';

// Bell icon in each portal's top bar - lets this device opt in to push
// notifications. Deliberately a manual opt-in rather than auto-subscribing
// on login: browsers require a user gesture before requesting notification
// permission, and silently prompting on every login would just train
// people to dismiss it. The cleaner home page also has a bigger card for
// the same thing (EnablePushCard); both go through lib/pushSubscription.
//
// `describe` is what the pushes are, in the words of whoever is looking at
// the bell: the office gets alerts and requests, a cleaner gets shift
// updates and messages, a client is told when their cleaner arrives and
// finishes. One shared bell used to tell every one of them it was for
// emergency alerts, which only the office ever receives.
export default function EnablePush({ iconColor = 'var(--muted)', describe = 'alerts and requests' }) {
  const toast = useToast();
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSupported(pushSupported());
    hasPushSubscription().then(setSubscribed);
    return onPushChanged(() => setSubscribed(true));
  }, []);

  const enable = async () => {
    if (subscribed || busy) return;
    setBusy(true);
    const result = await subscribeToPush();
    setBusy(false);

    if (result === 'ok') {
      setSubscribed(true);
      toast.success(`Notifications for ${describe} will now push to this device.`);
    } else if (result === 'denied') {
      toast.error('Notifications were not allowed - you can enable them in your browser settings.');
    } else {
      toast.error('Could not enable push notifications on this device.');
    }
  };

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={enable}
      disabled={busy || subscribed}
      aria-label={subscribed ? 'Push notifications enabled' : `Enable push notifications for ${describe}`}
      title={subscribed ? 'Push notifications enabled on this device' : `Enable push notifications for ${describe}`}
      style={{ background: 'transparent', border: 'none', padding: 6, cursor: subscribed ? 'default' : 'pointer', display: 'flex', alignItems: 'center' }}
    >
      {subscribed ? <BellRing size={20} color="var(--wf-verified)" /> : <Bell size={20} color={iconColor} />}
    </button>
  );
}
