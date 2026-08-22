'use client';

import { useEffect } from 'react';
// Imported for its side effect: attaches the beforeinstallprompt listener
// at module scope, early enough to catch Chrome's one and only firing.
import '../../lib/pwaInstall';

export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  return null;
}
