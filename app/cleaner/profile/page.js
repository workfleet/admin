'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import BackButton from '../../components/BackButton';

export default function CleanerProfile() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setEmail(session.user.email || '');

    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, created_at')
      .eq('id', session.user.id)
      .single();

    setProfile(data);
    setFullName(data?.full_name || '');
    setLoading(false);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() || null })
      .eq('id', profile.id);

    setSaving(false);
    if (!error) setSaved(true);
  };

  if (loading) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <BackButton />
      <h1>My Profile</h1>
      <form className="card" onSubmit={save}>
        <label>Full name</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />

        <label>Email</label>
        <input value={email} disabled />

        <label>Member since</label>
        <input value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : ''} disabled />

        {saved && <p style={{ color: 'var(--wf-verified-ink)', fontSize: 14 }}>Saved.</p>}
        <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
      </form>
    </div>
  );
}
