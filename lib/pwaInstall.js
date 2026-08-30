// Chrome fires `beforeinstallprompt` exactly once, a second or two after
// load - usually before the cleaner layout has mounted its install bar.
// Importing this module attaches the listener at module scope so the
// event is stashed rather than lost; RegisterSW imports it from the root
// layout so that happens on every page, whatever mounts later.
//
// The event only exists on Chromium. iOS has no equivalent - there the
// install bar falls back to Share-sheet instructions instead.

let deferredPrompt = null;
const listeners = new Set();

const notify = () => listeners.forEach((fn) => fn(deferredPrompt));

if (typeof window !== 'undefined') {
  // The inline snippet in the root layout head runs long before this
  // chunk does, so anything it caught is waiting for us here.
  if (window.__wfInstallEvent) deferredPrompt = window.__wfInstallEvent;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Without this Chrome shows its own mini-infobar and ours as well.
    event.preventDefault();
    deferredPrompt = event;
    notify();
  });

  // Fires whether they installed from our bar or from Chrome's own menu,
  // so it is the one reliable signal to stop offering.
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.__wfInstallEvent = null;
    notify();
  });
}

export function getInstallPrompt() {
  return deferredPrompt;
}

export function onInstallPromptChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Returns 'accepted', 'dismissed', or 'unavailable'. The event is
// single-use - Chrome refuses a second prompt() on the same one - so it
// is cleared either way.
export async function fireInstallPrompt() {
  if (!deferredPrompt) return 'unavailable';

  const event = deferredPrompt;
  deferredPrompt = null;
  window.__wfInstallEvent = null;
  notify();

  event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

// --- Platform detection -----------------------------------------------
// Shared by the install bar and the onboarding steps so the two can never
// disagree about what phone somebody is holding. All of these touch
// `window`/`navigator`, so only call them from an effect, never in render.

export function isStandalone() {
  // matchMedia covers Android and desktop; navigator.standalone is the
  // iOS-only equivalent and the only one that works there.
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

export function isIos() {
  const ua = navigator.userAgent;
  // iPadOS 13+ claims to be a Mac. The touch-point count is what still
  // gives it away - a real Mac reports 0.
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isIosSafari() {
  // Every iOS browser is WebKit underneath, but the Add to Home Screen
  // item lives in Safari's share sheet. Chrome and Firefox for iOS grew
  // their own in 16.4, but our wording only matches Safari's, so anyone
  // else gets pointed at Safari instead.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(navigator.userAgent);
}
