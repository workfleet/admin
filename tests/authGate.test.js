import { describe, it, expect, beforeEach } from 'vitest';
import { rememberSession, recallSession, clearRememberedSession } from '../lib/authGate';

// The offline fallback that keeps a signed-in cleaner in the app when the
// signal drops mid-shift. What matters: the role a full sign-in stored is not
// wiped by a later session-only refresh, and a sign-out clears it so a shared
// phone does not let the next person in as the last one.

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _dump: () => Object.fromEntries(map),
  };
}

let store;
beforeEach(() => { store = fakeStorage(); });

describe('rememberSession and recallSession', () => {
  it('round-trips the user and role', () => {
    rememberSession('u1', 'cleaner', store);
    expect(recallSession(store)).toMatchObject({ userId: 'u1', role: 'cleaner' });
  });

  it('survives a round trip through string storage', () => {
    rememberSession('u1', 'cleaner', store);
    const fresh = fakeStorage(store._dump());
    expect(recallSession(fresh)).toMatchObject({ userId: 'u1', role: 'cleaner' });
  });

  it('keeps the stored role when a later call knows only the user', () => {
    // getSessionWithRetry has the session but not the role; it must refresh
    // the user id without erasing the role getSessionAndProfile saved, or an
    // offline layout would fall back to a null role and misroute the cleaner.
    rememberSession('u1', 'cleaner', store);
    rememberSession('u1', undefined, store);
    expect(recallSession(store).role).toBe('cleaner');
  });

  it('replaces the role when a new user signs in on the device', () => {
    rememberSession('u1', 'cleaner', store);
    rememberSession('u2', undefined, store);
    // A different user with no known role: the old role must not leak onto them.
    expect(recallSession(store)).toMatchObject({ userId: 'u2', role: null });
  });

  it('replaces the role when an explicit new role is given', () => {
    rememberSession('u1', 'cleaner', store);
    rememberSession('u1', 'supervisor', store);
    expect(recallSession(store).role).toBe('supervisor');
  });

  it('ignores a call with no user id', () => {
    rememberSession(null, 'cleaner', store);
    expect(recallSession(store)).toBeNull();
  });

  it('returns null for empty or junk storage', () => {
    expect(recallSession(store)).toBeNull();
    store.setItem('wf.session.v1', 'not json');
    expect(recallSession(store)).toBeNull();
  });
});

describe('clearRememberedSession', () => {
  it('removes the record so the fallback stops recognising the device', () => {
    rememberSession('u1', 'cleaner', store);
    clearRememberedSession(store);
    expect(recallSession(store)).toBeNull();
  });

  it('does nothing when there is nothing to clear', () => {
    expect(() => clearRememberedSession(store)).not.toThrow();
    expect(recallSession(store)).toBeNull();
  });
});
