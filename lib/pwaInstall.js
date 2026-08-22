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
  notify();

  event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}
