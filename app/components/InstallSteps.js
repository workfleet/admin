'use client';

import { useEffect, useState } from 'react';
import { Check, Download, Share, Smartphone, SquarePlus } from 'lucide-react';
import {
  getInstallPrompt,
  onInstallPromptChange,
  fireInstallPrompt,
  isStandalone,
  isIos,
  isIosSafari,
} from '../../lib/pwaInstall';

// The install instructions as a plain card, for the end of onboarding -
// the one moment we know a new cleaner is looking at the app and has not
// got it on their phone yet. Unlike InstallPrompt this never hides
// itself: it is not an interruption to be dismissed, it is the last step
// of signing up, and it answers for desktop too because plenty of people
// will have finished the form on a laptop.
export default function InstallSteps() {
  const [platform, setPlatform] = useState(null); // installed | ios | android | desktop
  const [canPrompt, setCanPrompt] = useState(false);
  const [safari, setSafari] = useState(true);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setPlatform('installed');
      return undefined;
    }

    if (isIos()) {
      setSafari(isIosSafari());
      setPlatform('ios');
      return undefined;
    }

    // A coarse pointer is the practical test for "is this a phone". Getting
    // it wrong is cheap in both directions - the worst case is showing
    // someone the manual Chrome menu route on a touchscreen laptop.
    setPlatform(window.matchMedia?.('(pointer: coarse)').matches ? 'android' : 'desktop');
    setCanPrompt(Boolean(getInstallPrompt()));
    return onInstallPromptChange((event) => setCanPrompt(Boolean(event)));
  }, []);

  const install = async () => {
    const outcome = await fireInstallPrompt();
    if (outcome === 'accepted') setInstalled(true);
  };

  if (!platform) return null;

  if (platform === 'installed' || installed) {
    return (
      <div className="install-steps install-steps-done">
        <Check size={18} aria-hidden="true" />
        <span>The app is on your home screen — you're all set.</span>
      </div>
    );
  }

  return (
    <div className="install-steps">
      <div className="install-steps-head">
        <img src="/icon-192.png" alt="" className="install-steps-icon" />
        <div>
          <strong>Put WorkFleet on your phone</strong>
          <span>
            Your shifts, check-ins and messages in one tap, with no link to hunt for.
            {/* True on iOS only - Android delivers web push to the browser
                whether or not the app has been installed. */}
            {platform === 'ios' && ' On iPhone it is also the only way to get notified about your work.'}
          </span>
        </div>
      </div>

      {platform === 'ios' && (
        <ol className="install-steps-list">
          {safari ? (
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

      {platform === 'android' && (
        canPrompt ? (
          <button type="button" className="install-steps-action" onClick={install}>
            <Download size={16} aria-hidden="true" />
            Add to home screen
          </button>
        ) : (
          <ol className="install-steps-list">
            <li>
              <SquarePlus size={16} aria-hidden="true" />
              <span>
                Open your browser's menu and tap <strong>Install app</strong> (or{' '}
                <strong>Add to Home screen</strong>).
              </span>
            </li>
          </ol>
        )
      )}

      {platform === 'desktop' && (
        <ol className="install-steps-list">
          <li>
            <Smartphone size={16} aria-hidden="true" />
            <span>
              Open this site on your phone and sign in, then add it to your home screen — iPhone:
              Share then <strong>Add to Home Screen</strong>; Android: menu then{' '}
              <strong>Install app</strong>.
            </span>
          </li>
        </ol>
      )}
    </div>
  );
}
