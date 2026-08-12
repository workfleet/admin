'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

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
      if (session) await redirectByRole(session.user.id);
    };
    checkSession();
  }, []);

  const redirectByRole = async (userId) => {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, active')
      .eq('id', userId)
      .single();

    if (profile?.active === false) {
      await supabase.auth.signOut();
      setError('This account has been deactivated. Contact your admin.');
      return;
    }

    if (profile?.role === 'admin') router.push('/admin');
    else if (profile?.role === 'client') router.push('/client');
    else router.push('/cleaner');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data, error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (loginError) {
      setError(loginError.message);
      return;
    }

    await redirectByRole(data.user.id);
  };

  return (
    <div className="container login-page">
      <div className="brand-mark">WF</div>
      <h1>Workfleet</h1>
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
        {info && <p style={{ color: 'var(--brand-primary-dark)', fontSize: 14 }}>{info}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Please wait...' : 'Log in'}
        </button>
      </form>
      <p style={{ marginTop: 12, fontSize: 14, color: 'var(--muted)' }}>
        New staff get an account set up via their onboarding invite link.
      </p>
    </div>
  );
}