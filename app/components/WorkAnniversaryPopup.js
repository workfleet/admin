'use client';

import { useEffect, useState } from 'react';

export default function WorkAnniversaryPopup({ name, years }) {
  const [dismissed, setDismissed] = useState(true);
  const storageKey = `wf-anniversary-dismissed-${new Date().toDateString()}`;

  useEffect(() => {
    setDismissed(!!localStorage.getItem(storageKey));
  }, [storageKey]);

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(storageKey, '1');
    setDismissed(true);
  };

  return (
    <div
      onClick={dismiss}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 340, width: '100%', textAlign: 'center', padding: 28 }}
      >
        <div style={{ fontSize: 40, lineHeight: 1 }}>🎉</div>
        <h2 style={{ margin: '12px 0 4px' }}>Happy Workiversary, {name}!</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 18px' }}>
          {years} year{years === 1 ? '' : 's'} with CrewConnect Cleaning today. Thank you for everything you do!
        </p>
        <button className="btn-primary" onClick={dismiss} style={{ width: '100%' }}>Thanks!</button>
      </div>
    </div>
  );
}
