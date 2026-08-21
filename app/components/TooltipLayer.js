'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Every button in the app explains itself through a plain `title`
// attribute. The browser's own tooltip renders those on desktop only -
// nothing appears on a phone, which is where every cleaner works. This
// takes those titles over and renders them itself: hover on a mouse,
// focus on a keyboard, and press-and-hold on touch.
//
// Mounted once at the root rather than wrapped around each button, so
// the ~140 title attributes already scattered through the app don't have
// to change, and any new one is picked up for free.

const SHOW_DELAY_MS = 350;
const LONG_PRESS_MS = 450;
const TOUCH_VISIBLE_MS = 4000;
const MAX_WIDTH = 280;

// The bubble is centred on its anchor and can't be measured before it
// renders, so clamp on half the widest it's allowed to get. Slightly
// conservative near the screen edge, never clipped.
const EDGE_MARGIN = MAX_WIDTH / 2 + 8;

export default function TooltipLayer() {
  const [tip, setTip] = useState(null);
  const showTimer = useRef(null);
  const hideTimer = useRef(null);
  // A long press has to swallow the click it would otherwise become -
  // holding a button to read what it does must never also press it.
  const swallowClick = useRef(false);

  const clearTimers = () => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
  };

  const hide = useCallback(() => {
    clearTimers();
    setTip(null);
  }, []);

  const show = useCallback((el) => {
    const text = el.getAttribute('data-tip');
    if (!text) return;

    const rect = el.getBoundingClientRect();
    const centre = rect.left + rect.width / 2;
    const above = rect.top > 96;

    setTip({
      text,
      left: Math.min(Math.max(centre, EDGE_MARGIN), window.innerWidth - EDGE_MARGIN),
      above,
      top: above ? undefined : rect.bottom + 8,
      bottom: above ? window.innerHeight - rect.top + 8 : undefined,
    });
  }, []);

  useEffect(() => {
    // ---- Take the titles over from the browser ----
    const adopt = (el) => {
      const text = el.getAttribute && el.getAttribute('title');
      if (!text) return;
      el.setAttribute('data-tip', text);
      // Removing it is what stops the native tooltip appearing as well.
      // Nothing loses its accessible name by this: the icon-only buttons
      // all carry an aria-label, and the rest have visible text.
      el.removeAttribute('title');
    };

    const adoptWithin = (root) => {
      if (root.nodeType !== 1) return;
      adopt(root);
      root.querySelectorAll('[title]').forEach(adopt);
    };

    adoptWithin(document.body);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') adopt(record.target);
        else record.addedNodes.forEach(adoptWithin);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['title'],
    });

    // ---- Mouse ----
    const onPointerOver = (e) => {
      if (e.pointerType === 'touch') return;
      const el = e.target.closest?.('[data-tip]');
      if (!el) return;
      clearTimers();
      showTimer.current = setTimeout(() => show(el), SHOW_DELAY_MS);
    };

    const onPointerOut = (e) => {
      if (e.pointerType === 'touch') return;
      if (e.target.closest?.('[data-tip]')) hide();
    };

    // ---- Touch: press and hold ----
    const onPointerDown = (e) => {
      if (e.pointerType !== 'touch') return;
      const el = e.target.closest?.('[data-tip]');
      if (!el) { hide(); return; }
      clearTimers();
      showTimer.current = setTimeout(() => {
        swallowClick.current = true;
        show(el);
        hideTimer.current = setTimeout(hide, TOUCH_VISIBLE_MS);
      }, LONG_PRESS_MS);
    };

    const cancelPress = () => clearTimeout(showTimer.current);

    const onClick = (e) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    };

    // ---- Keyboard ----
    const onFocusIn = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (el) show(el);
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', cancelPress);
    document.addEventListener('pointercancel', cancelPress);
    document.addEventListener('pointermove', cancelPress);
    // Capture phase, so the click is swallowed before it reaches the button.
    document.addEventListener('click', onClick, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);

    return () => {
      clearTimers();
      observer.disconnect();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', cancelPress);
      document.removeEventListener('pointercancel', cancelPress);
      document.removeEventListener('pointermove', cancelPress);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [show, hide]);

  return (
    <>
      {/* Kept here rather than in globals.css so the whole feature is one
          file. Only touch devices get the callout suppression - a long
          press must show the tooltip, not iOS's copy/paste menu. */}
      <style>{`
        @media (hover: none) {
          [data-tip] { -webkit-touch-callout: none; }
        }
        @keyframes wf-tip-in {
          from { opacity: 0; transform: translateX(-50%) scale(0.96); }
          to   { opacity: 1; transform: translateX(-50%) scale(1); }
        }
      `}</style>

      {tip && (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: tip.left,
            top: tip.top,
            bottom: tip.bottom,
            transform: 'translateX(-50%)',
            transformOrigin: tip.above ? 'bottom center' : 'top center',
            animation: 'wf-tip-in 120ms ease-out',
            maxWidth: MAX_WIDTH,
            padding: '8px 11px',
            borderRadius: 'var(--wf-radius-sm, 6px)',
            background: 'var(--wf-graphite, #202327)',
            color: 'var(--wf-white, #ffffff)',
            // Graphite on graphite: over the sidebar the bubble would
            // otherwise dissolve into the panel behind it.
            border: '1px solid var(--wf-line-dark, rgba(255, 255, 255, 0.15))',
            fontFamily: 'var(--wf-display, inherit)',
            fontSize: 12.5,
            lineHeight: 1.45,
            fontWeight: 500,
            textAlign: 'center',
            boxShadow: '0 10px 24px rgba(32, 35, 39, 0.28), 0 2px 6px rgba(32, 35, 39, 0.16)',
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          {tip.text}
        </div>
      )}
    </>
  );
}
