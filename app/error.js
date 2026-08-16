'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container login-page">
      <div className="brand-mark">WF</div>
      <h1>Something went wrong</h1>
      <p className="login-subtitle">
        That's on us, not you. Try again, or head back and pick up where you left off.
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button type="button" onClick={() => reset()}>Try again</button>
        <Link href="/">
          <button type="button" className="btn-secondary">Back to Home</button>
        </Link>
      </div>
    </div>
  );
}
