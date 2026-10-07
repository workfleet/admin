import { describe, it, expect, beforeEach, vi } from 'vitest';

// Weak signal, not no signal: the phone says it is online (navigator.onLine
// is true) but nothing gets through. Supabase's token refresh then fails with
// AuthRetryableFetchError and getSession() hands back null. The gate used to
// read that as "signed out" and send the cleaner to a login page that could
// not reach the server either - Sarah Brock's "always has issues logging in".

const getSession = vi.fn();
const single = vi.fn();
vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    auth: { getSession: (...a) => getSession(...a) },
    from: () => ({ select: () => ({ eq: () => ({ single: (...a) => single(...a) }) }) }),
  },
}));

const { isNetworkError, loginErrorMessage, getSessionAndProfile, getSessionWithRetry, rememberSession, clearRememberedSession } =
  await import('../lib/authGate');

function retryable() {
  const e = new Error('Failed to fetch');
  e.name = 'AuthRetryableFetchError';
  return e;
}

function memoryStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

beforeEach(() => {
  getSession.mockReset();
  single.mockReset();
  vi.stubGlobal('window', { localStorage: memoryStorage() });
  vi.stubGlobal('navigator', { onLine: true });
  clearRememberedSession();
});

describe('isNetworkError', () => {
  it('spots a failed token refresh and the browsers\' own fetch failures', () => {
    expect(isNetworkError(retryable())).toBe(true);
    expect(isNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isNetworkError({ message: 'Load failed' })).toBe(true);
    expect(isNetworkError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(true);
  });

  it('leaves real answers from the server alone', () => {
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError({ name: 'AuthApiError', message: 'Invalid login credentials' })).toBe(false);
    expect(isNetworkError({ message: 'JSON object requested, multiple (or no) rows returned' })).toBe(false);
  });
});

describe('loginErrorMessage', () => {
  it('turns "Failed to fetch" into a signal message', () => {
    expect(loginErrorMessage(retryable())).toMatch(/Can't reach the server/);
  });

  it('keeps a wrong-password message as it is', () => {
    expect(loginErrorMessage({ name: 'AuthApiError', message: 'Invalid login credentials' })).toBe('Invalid login credentials');
  });
});

describe('weak signal with navigator.onLine still true', () => {
  it('keeps a remembered cleaner in the app when the token refresh cannot get through', async () => {
    rememberSession('sarah', 'cleaner');
    getSession.mockResolvedValue({ data: { session: null }, error: retryable() });

    const result = await getSessionAndProfile();
    expect(result.session?.user.id).toBe('sarah');
    expect(result.profile.role).toBe('cleaner');
    expect(result.offline).toBe(true);

    expect((await getSessionWithRetry())?.user.id).toBe('sarah');
  });

  it('falls back to the remembered role when the profile lookup cannot get through', async () => {
    rememberSession('sarah', 'cleaner');
    getSession.mockResolvedValue({ data: { session: { user: { id: 'sarah' } } }, error: null });
    single.mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch' } });

    const result = await getSessionAndProfile();
    expect(result.profile.role).toBe('cleaner');
    expect(result.error).toBe(null);
  });

  it('still sends a genuinely signed-out phone to login', async () => {
    rememberSession('sarah', 'cleaner');
    getSession.mockResolvedValue({ data: { session: null }, error: null });

    const result = await getSessionAndProfile();
    expect(result.session).toBe(null);
  });

  it('does not invent a sign-in on a phone that never had one', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: retryable() });
    expect((await getSessionAndProfile()).session).toBe(null);
  });
});
