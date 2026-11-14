'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

// A "More" button that opens a short list of the less-used actions on a
// page (export, end a relationship, delete...), so the header shows one
// clear action instead of a row of equal buttons - and Delete is not sitting
// out in the open.
//
// items: [{ label, onClick, title?, danger?, disabled? }] - falsy entries
// are skipped, so callers can write `cond && { ... }`. Danger items sit last,
// under a divider.
export default function MoreMenu({ items, label = 'More' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const list = items.filter(Boolean);
  const safe = list.filter((i) => !i.danger);
  const danger = list.filter((i) => i.danger);
  if (list.length === 0) return null;

  const run = (item) => {
    setOpen(false);
    item.onClick();
  };

  const renderItem = (item) => (
    <button
      key={item.label}
      type="button"
      role="menuitem"
      className={`more-menu-item${item.danger ? ' is-danger' : ''}`}
      onClick={() => run(item)}
      disabled={item.disabled}
      title={item.title}
    >
      {item.label}
    </button>
  );

  return (
    <div className="more-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn-secondary more-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="More actions"
      >
        <MoreHorizontal size={16} aria-hidden="true" /> {label}
      </button>
      {open && (
        <div className="more-menu-list" role="menu">
          {safe.map(renderItem)}
          {safe.length > 0 && danger.length > 0 && <div className="more-menu-divider" role="separator" />}
          {danger.map(renderItem)}
        </div>
      )}
    </div>
  );
}
