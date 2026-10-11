'use client';

import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { useToast } from './ToastProvider';
import {
  pushSupported, notificationPermission, hasPushSubscription, subscribeToPush, onPushChanged,
} from '../../lib/pushSubscription';
import { isIos, isStandalone } from '../../lib/pwaInstall';

const DISMISS_KEY = 'wf-push-card-dismissed-at';
const SNOOZE_DAYS = 7;

function snoozed() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Boolean(at) && Date.now() - at < SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

// The bell in the top bar was the only way to turn push on, and on
// 2026-10-11 three of nineteen cleaners had found it - so a cover shift
// posted for the weekend reached three phones. This card asks plainly, on
// the home page, until this device is pushing. Gone once it is, and for a
// week after "Not now".
export default function EnablePushCard() {
  const toast = useToast();
  // 'ask' | 'blocked' | 'iphone' | null
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const decide = async () => {
      if (snoozed()) return;
      // iPhone only offers push to the Home Screen app; in Safari there is
      // nothing to subscribe to, so say how to get there instead.
      if (isIos() && !isStandalone() && !pushSupported()) {
        if (!cancelled) setMode('iphone');
        return;
      }
      if (!pushSupported()) return;
      if (await hasPushSubscription()) return;
      if (cancelled) return;
      setMode(notificationPermission() === 'denied' ? 'blocked' : 'ask');
    };
    decide();
    const off = onPushChanged(() => setMode(null));
    return () => { cancelled = true; off(); };
  }, []);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // They just get asked again next visit.
    }
    setMode(null);
  };

  const enable = async () => {
    setBusy(true);
    const result = await subscribeToPush();
    setBusy(false);
    if (result === 'ok') {
      setMode(null);
      toast.success("Alerts are on - you'll hear about cover shifts and rota changes.");
    } else if (result === 'denied') {
      setMode('blocked');
    } else {
      toast.error("Couldn't turn alerts on - try again in a moment.");
    }
  };

  if (!mode) return null;

  return (
    <div className="card" style={{ background: 'var(--wf-ash)', position: 'relative', marginTop: 12 }}>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        title="Not now - ask again next week"
        style={{ position: 'absolute', top: 8, right: 8, background: 'transparent', border: 'none', padding: 6, cursor: 'pointer' }}
      >
        <X size={18} color="var(--muted)" />
      </button>
      <div style={{ display: 'flex', gap: 10, paddingRight: 28 }}>
        <BellRing size={20} color="var(--wf-steel)" style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Turn on alerts</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
            {mode === 'ask' && 'Get a buzz on your phone when a shift needs cover, your rota changes or you have a message.'}
            {mode === 'blocked' && 'Alerts are blocked for this site. Tap the padlock or ⋮ menu by the web address, open Notifications and choose Allow, then reload.'}
            {mode === 'iphone' && 'On iPhone, alerts only work from the app on your Home Screen. Add it with Share → Add to Home Screen, open it from there, then turn alerts on.'}
          </div>
        </div>
      </div>
      {mode === 'ask' && (
        <button type="button" onClick={enable} disabled={busy} style={{ width: '100%', marginTop: 10 }}>
          {busy ? 'Just a sec...' : 'Turn on alerts'}
        </button>
      )}
    </div>
  );
}
