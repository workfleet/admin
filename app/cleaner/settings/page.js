'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { signOutAndClearPresence } from '../../../lib/signOut';

export default function CleanerSettings() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const changePassword = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
    } else {
      setMessage('Password updated.');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const logout = async () => {
    await signOutAndClearPresence();
    router.push('/');
  };

  return (
    <div className="container">
      <h1>Settings</h1>

      <form className="card" onSubmit={changePassword}>
        <h2>Change Password</h2>
        <label>New password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
        <label>Confirm new password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Re-enter password"
        />
        {error && <p style={{ color: '#c0392b', fontSize: 14 }}>{error}</p>}
        {message && <p style={{ color: 'var(--brand-primary-dark)', fontSize: 14 }}>{message}</p>}
        <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Update Password'}</button>
      </form>

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Account</h2>
        <button className="btn-secondary" onClick={logout} style={{ marginTop: 8 }}>Log Out</button>
      </div>
    </div>
  );
}
