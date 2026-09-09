'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { STAFF_DETAIL_FIELDS, detailsToForm, formToDetails, formatDateOnly } from '../../../lib/staffDetails';
import BackButton from '../../components/BackButton';

// The fields a person maintains about themself. Start date is the office's
// to set, so it is shown here but not edited.
const OWN_FIELDS = STAFF_DETAIL_FIELDS.filter((f) => !f.officeOnly);
const OWN_KEYS = OWN_FIELDS.map((f) => f.key);

export default function CleanerProfile() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [details, setDetails] = useState(null);
  const [form, setForm] = useState(() => detailsToForm(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setEmail(session.user.email || '');

    const [{ data }, { data: detailsData }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, created_at').eq('id', session.user.id).single(),
      supabase
        .from('staff_details')
        .select('phone, address, date_of_birth, ni_number, emergency_contact_name, emergency_contact_phone, start_date')
        .eq('profile_id', session.user.id)
        .maybeSingle(),
    ]);

    setProfile(data);
    setFullName(data?.full_name || '');
    setDetails(detailsData || null);
    setForm(detailsToForm(detailsData));
    setLoading(false);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError('');

    const { error: nameError } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() || null })
      .eq('id', profile.id);

    // Only the fields on this form are sent, so the office's start date is
    // left exactly as it was.
    const { data: savedDetails, error: detailsError } = await supabase
      .from('staff_details')
      .upsert({
        profile_id: profile.id,
        ...formToDetails(form, OWN_KEYS),
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      }, { onConflict: 'profile_id' })
      .select('phone, address, date_of_birth, ni_number, emergency_contact_name, emergency_contact_phone, start_date')
      .single();

    setSaving(false);
    if (nameError || detailsError) {
      setError("Couldn't save your details. Please try again.");
      return;
    }
    setDetails(savedDetails);
    setForm(detailsToForm(savedDetails));
    setSaved(true);
  };

  if (loading) return <div className="container">Loading...</div>;

  return (
    <div className="container">
      <BackButton />
      <h1>My Profile</h1>
      <form className="card" onSubmit={save}>
        <label>Full name</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" autoComplete="name" />

        <label>Email</label>
        <input value={email} disabled />

        <label>Member since</label>
        <input value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : ''} disabled />

        {details?.start_date && (
          <>
            <label>Start date</label>
            <input value={formatDateOnly(details.start_date)} disabled />
          </>
        )}

        <h2 style={{ marginTop: 18 }}>Your details</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: -4 }}>
          Only the office can see these. Keep them up to date so we can reach you, and reach someone for you if we ever need to.
        </p>

        {OWN_FIELDS.map((f) => (
          <div key={f.key}>
            <label>{f.label}</label>
            <input
              type={f.type}
              value={form[f.key]}
              onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              autoComplete={f.autoComplete || 'off'}
            />
          </div>
        ))}

        {saved && <p style={{ color: 'var(--wf-verified-ink)', fontSize: 14 }}>Saved.</p>}
        {error && <p style={{ color: 'var(--wf-overdue)', fontSize: 14 }}>{error}</p>}
        <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</button>
      </form>
    </div>
  );
}
