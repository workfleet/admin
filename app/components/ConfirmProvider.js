'use client';

import { createContext, useCallback, useContext, useState } from 'react';

const ConfirmContext = createContext(null);

// Drop-in replacement for window.confirm() - same call shape (message in,
// boolean out) but returns a Promise so call sites just need "await" added,
// and renders a branded modal instead of the browser's native dialog.
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirmAction = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      setState({
        message,
        title: opts.title || null,
        danger: !!opts.danger,
        confirmLabel: opts.confirmLabel || (opts.danger ? 'Delete' : 'Confirm'),
        cancelLabel: opts.cancelLabel || 'Cancel',
        resolve,
      });
    });
  }, []);

  const settle = (result) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirmAction}>
      {children}
      {state && (
        <div className="confirm-overlay" onClick={() => settle(false)}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            {state.title && <h2>{state.title}</h2>}
            <p>{state.message}</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={() => settle(false)}>
                {state.cancelLabel}
              </button>
              <button type="button" className={state.danger ? 'btn-danger' : ''} onClick={() => settle(true)}>
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
