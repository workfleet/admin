'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Share, SquarePlus, Download } from 'lucide-react';
import { getInstallPrompt, onInstallPromptChange, fireInstallPrompt } from '../../lib/pwaInstall';

const DISMISS_KEY = 'wf-install-dismissed-at';
const SNOOZE_DAYS = 30;

function alreadyInstalled() {
  // matchMedia covers Android and desktop; navigator.standalone is the
  // iOS-only equivalent and the only one that works there.
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  const ua = navigator.userAgent;
  // iPadOS 13+ claims to be a Mac. The touch-point count is what still
  // gives it away - a real Mac reports 0.
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isIosSafari() {
  // Every iOS browser is WebKit underneath, but the Add to Home Screen
  // item lives in Safari's share sheet. Chrome and Firefox for iOS grew
  // their own in 16.4, but the wording below only matches Safari's, so
  // anyone else gets pointed at Safari instead.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(navigator.userAgent);
}

function snoozed() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    if (!at) return false;
    return Date.now() - at < SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    // Private mode can throw on localStorage. Erring towards showing the
    // bar is the harmless direction - it is still dismissable.
    return false;
  }
}

// Bottom bar on the cleaner app offering to install it to the home
// screen. Two quite different jobs behind one bar: on Android it fires
// Chrome's real install dialog, on iOS there is no such API so it can
// only show where the Share-sheet item is. Renders nothing at all once
// installed, on desktop, or for 30 days after a dismissal.
export default function InstallPrompt() {
  const [mode, setMode] = useState(null); // 'android' | 'ios' | null
  const [showSteps, setShowSteps] = useState(false);
  const barRef = useRef(null);

  useEffect(() => {
    if (alreadyInstalled() || snoozed()) return undefined;

    if (isIos()) {
      setMode('ios');
      return undefined;
    }

    // Chromium: only offer once the browser has told us it qualifies.
    if (getInstallPrompt()) setMode('android');
    return onInstallPromptChange((event) => setMode(event ? 'android' : null));
  }, []);

  // The bar is fixed, so the shell needs padding to match or the last
  // row of content sits under it - and the emergency button has to step
  // up out of the way. Measured rather than hard-coded because the iOS
  // panel changes height when the steps expand.
  useEffect(() => {
    const el = barRef.current;
    if (!el) {
      document.body.classList.remove('has-install-bar');
      document.body.style.removeProperty('--wf-install-bar-h');
      return undefined;
    }

    document.body.classList.add('has-install-bar');
    const measure = () => {
      document.body.style.setProperty('--wf-install-bar-h', `${el.offsetHeight}px`);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);

    return () => {
      observer.disconnect();
      document.body.classList.remove('has-install-bar');
      document.body.style.removeProperty('--wf-install-bar-h');
    };
  }, [mode, showSteps]);

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Nothing to do - it just means they get asked again next visit.
    }
    setMode(null);
  };

  const install = async () => {
    const outcome = await fireInstallPrompt();
    // A dismissed Chrome dialog burns the event, so the bar would be
    // dead weight if it stayed. Snooze it like an explicit dismissal.
    if (outcome !== 'accepted') dismiss();
    else setMode(null);
  };

  if (!mode) return null;

  return (
    <div ref={barRef} className="install-bar" role="region" aria-label="Install WorkFleet">
      <div className="install-bar-row">
        <img src="/icon-192.png" alt="" className="install-bar-icon" />

        <div className="install-bar-text">
          <strong>Install WorkFleet</strong>
          <span>Add it to your home screen so it opens in one tap.</span>
        </div>

        {mode === 'android' ? (
          <button type="button" className="install-bar-action" onClick={install}>
            <Download size={16} aria-hidden="true" />
            Install
          </button>
        ) : (
          <button
            type="button"
            className="install-bar-action"
            onClick={() => setShowSteps((s) => !s)}
            aria-expanded={showSteps}
          >
            {showSteps ? 'Hide' : 'How'}
          </button>
        )}

        <button type="button" className="install-bar-close" onClick={dismiss} aria-label="Not now">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {mode === 'ios' && showSteps && (
        <ol className="install-bar-steps">
          {isIosSafari() ? (
            <>
              <li>
                <Share size={16} aria-hidden="true" />
                <span>Tap the Share button at the bottom of Safari.</span>
              </li>
              <li>
                <SquarePlus size={16} aria-hidden="true" />
                <span>Scroll down and tap <strong>Add to Home Screen</strong>.</span>
              </li>
            </>
          ) : (
            <li>
              <Share size={16} aria-hidden="true" />
              <span>
                Open this page in <strong>Safari</strong>, then tap Share and{' '}
                <strong>Add to Home Screen</strong>.
              </span>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
