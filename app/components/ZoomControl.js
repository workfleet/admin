'use client';

import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

// A page-size control for the office screens. The rota and dashboard are
// dense, and on a laptop the week only fits once everything is a notch
// smaller - which the browser can do (Ctrl and minus), but nobody finds it,
// and it resets per site in some browsers. This remembers the choice on
// this device.
//
// It scales the whole page with CSS zoom rather than a transform, so
// layout, scrolling and sticky headers all work at the new size.

const STEPS = [70, 80, 90, 100, 110, 120];
const STORAGE_KEY = 'wf-page-zoom';

function applyZoom(percent) {
  document.documentElement.style.zoom = percent === 100 ? '' : String(percent / 100);
}

export default function ZoomControl() {
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    let saved = 100;
    try {
      saved = Number(window.localStorage.getItem(STORAGE_KEY)) || 100;
    } catch {
      // Storage can be blocked; the page just starts at full size.
    }
    if (!STEPS.includes(saved)) saved = 100;
    setZoom(saved);
    applyZoom(saved);
    // Leaving the office pages puts the page back to full size, so a
    // cleaner's screens are never shrunk by an admin's setting.
    return () => applyZoom(100);
  }, []);

  const choose = (percent) => {
    setZoom(percent);
    applyZoom(percent);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(percent));
    } catch {
      // Not remembered, but still applied for this visit.
    }
  };

  const index = STEPS.indexOf(zoom);

  return (
    <div className="zoom-control" role="group" aria-label="Page size">
      <button
        type="button"
        className="zoom-control-btn"
        onClick={() => choose(STEPS[index - 1])}
        disabled={index <= 0}
        aria-label="Make the page smaller"
        title="Smaller"
      >
        <Minus size={14} strokeWidth={2.4} />
      </button>
      <button
        type="button"
        className="zoom-control-value"
        onClick={() => choose(100)}
        title="Back to normal size"
      >
        {zoom}%
      </button>
      <button
        type="button"
        className="zoom-control-btn"
        onClick={() => choose(STEPS[index + 1])}
        disabled={index >= STEPS.length - 1}
        aria-label="Make the page bigger"
        title="Bigger"
      >
        <Plus size={14} strokeWidth={2.4} />
      </button>
    </div>
  );
}
