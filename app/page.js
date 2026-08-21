'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import { signOutAndClearPresence } from '../lib/signOut';
import { getSessionAndProfile } from '../lib/authGate';
import Logo from './components/Logo';

// The hard-navigation below depends on Supabase actually having written
// the new session to localStorage first - normally near-instant, but
// browsers with blocked/partitioned storage (private browsing, strict
// tracking-prevention modes, some locked-down corporate profiles) never
// complete that write, so the fresh reload finds no session and bounces
// straight back to login with no visible error. This checks for the
// real sb-*-auth-token key rather than assuming the write succeeded.
function sessionPersisted() {
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
        const raw = window.localStorage.getItem(key);
        if (raw && raw.includes('access_token')) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) await redirectByRole();
    };
    checkSession();
  }, []);

  // No longer takes a userId - re-fetches session itself via
  // getSessionAndProfile(), which retries once on a failed profile
  // lookup instead of treating that failure the same as "no such
  // role" and silently guessing a destination (previously: an admin
  // whose profile fetch hit a transient error would get routed to
  // /cleaner instead of /admin, with no visible error at all).
  const redirectByRole = async () => {
    const { session, profile, error: fetchError } = await getSessionAndProfile();
    if (!session) return;

    if (fetchError) {
      setError("Couldn't load your account - please check your connection and try again.");
      return;
    }

    if (profile?.active === false) {
      await signOutAndClearPresence();
      setError('This account has been deactivated. Contact your admin.');
      return;
    }

    // Hard navigation (not router.push) is deliberate: if this login
    // followed an invalid-refresh-token kickout, a stale retry from that
    // earlier failed background refresh can still be in flight in this
    // tab and clear the brand-new session moments later. A full reload
    // gives the browser a fresh Supabase client with no memory of the
    // old failure, so the new login actually sticks. But that reload
    // only works if the session actually made it into localStorage first
    // - confirm that before committing to it, and fall back to an
    // in-memory soft navigation (no reload, so no storage round-trip)
    // if it didn't, rather than silently bouncing back to login.
    const destination = profile?.role === 'admin' || profile?.role === 'supervisor'
      ? '/admin'
      : profile?.role === 'client' ? '/client' : '/cleaner';

    let persisted = sessionPersisted();
    for (let i = 0; i < 6 && !persisted; i++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      persisted = sessionPersisted();
    }

    if (persisted) {
      window.location.href = destination;
    } else {
      setError("This browser isn't saving your sign-in - if you're in private/incognito browsing or have site data blocked, you may need to log in again after navigating. Taking you in now.");
      router.push(destination);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (loginError) {
      setError(loginError.message);
      return;
    }

    await redirectByRole();
  };

  return (
    <div className="container login-page">
      <h1 className="brand-mark"><Logo size={44} showWordmark /></h1>
      <p className="login-subtitle">Sign in to manage your crew</p>
      <form className="card" onSubmit={handleLogin}>
        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p style={{ color: 'crimson', fontSize: 14 }}>{error}</p>}
        {info && <p style={{ color: 'var(--wf-verified-ink)', fontSize: 14 }}>{info}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Please wait...' : 'Log in'}
        </button>
      </form>
      <p style={{ marginTop: 12, fontSize: 14, color: 'var(--muted)' }}>
        New staff get an account set up via their onboarding invite link.
      </p>
      <Link href="/privacy" style={{ marginTop: 20, fontSize: 13, color: 'var(--muted)' }}>Privacy Notice</Link>
    </div>
  );
}