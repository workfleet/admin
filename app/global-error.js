'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// Catches what app/error.js cannot: a failure in the root layout itself.
// At that point none of the app's own chrome is available, so this renders
// its own document and keeps the markup to a minimum.
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en-GB">
      <body>
        <div className="container login-page">
          <h1>Something went wrong</h1>
          <p className="login-subtitle">
            That's on us, not you. Try again, or reload the page.
          </p>
          <button type="button" onClick={() => reset()}>Try again</button>
        </div>
      </body>
    </html>
  );
}
