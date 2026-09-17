'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { STAFF_DETAIL_FIELDS, detailsToForm, formToDetails, formatDateOnly } from '../../../lib/staffDetails';
import { BANK_DETAIL_FIELDS, emptyBankForm, formToBankDetails, formatSortCode, maskAccountNumber } from '../../../lib/bankDetails';
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

  // Bank details (staff_bank_details, 0099) live on their own card with
  // their own save, so a slip while updating a phone number can never
  // touch where the pay goes, and the other way round.
  const [bank, setBank] = useState(null);
  const [bankForm, setBankForm] = useState(() => emptyBankForm());
  const [editingBank, setEditingBank] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [bankSaved, setBankSaved] = useState(false);
  const [bankError, setBankError] = useState('');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setEmail(session.user.email || '');

    const [{ data }, { data: detailsData }, { data: bankData }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, created_at').eq('id', session.user.id).single(),
      supabase
        .from('staff_details')
        .select('phone, address, date_of_birth, ni_number, emergency_contact_name, emergency_contact_phone, start_date')
        .eq('profile_id', session.user.id)
        .maybeSingle(),
      supabase
        .from('staff_bank_details')
        .select('account_holder_name, sort_code, account_number, updated_at')
        .eq('profile_id', session.user.id)
        .maybeSingle(),
    ]);

    setProfile(data);
    setFullName(data?.full_name || '');
    setDetails(detailsData || null);
    setForm(detailsToForm(detailsData));
    setBank(bankData || null);
    setLoading(false);
  };

  const startEditBank = () => {
    setBankForm(emptyBankForm());
    setBankError('');
    setBankSaved(false);
    setEditingBank(true);
  };

  const saveBank = async (e) => {
    e.preventDefault();
    setBankError('');
    setBankSaved(false);

    const { row, error: shapeError } = formToBankDetails(bankForm);
    if (shapeError) { setBankError(shapeError); return; }

    setSavingBank(true);
    const { data: savedBank, error: saveError } = await supabase
      .from('staff_bank_details')
      .upsert({
        profile_id: profile.id,
        ...row,
        updated_at: new Date().toISOString(),
        updated_by: profile.id,
      }, { onConflict: 'profile_id' })
      .select('account_holder_name, sort_code, account_number, updated_at')
      .single();
    setSavingBank(false);

    if (saveError || !savedBank) {
      setBankError("Couldn't save your bank details. Please check them and try again.");
      return;
    }
    setBank(savedBank);
    setBankForm(emptyBankForm());
    setEditingBank(false);
    setBankSaved(true);
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

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ marginTop: 0 }}>Bank details</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: -4 }}>
          Where your pay goes. Only the office can see these, and they are told whenever they change.
        </p>

        {!editingBank && (
          <>
            {bank ? (
              <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.9 }}>
                <div>Name on the account: <span style={{ color: 'var(--ink)' }}>{bank.account_holder_name}</span></div>
                <div>Sort code: <span style={{ color: 'var(--ink)' }}>{formatSortCode(bank.sort_code)}</span></div>
                <div>Account number: <span style={{ color: 'var(--ink)' }}>{maskAccountNumber(bank.account_number)}</span></div>
                {bank.updated_at && (
                  <div style={{ fontSize: 12, marginTop: 2 }}>Last updated {new Date(bank.updated_at).toLocaleDateString()}</div>
                )}
              </div>
            ) : (
              <p className="empty-state" style={{ marginBottom: 8 }}>
                No bank details on file yet. Add them so the office can pay you.
              </p>
            )}
            {bankSaved && <p style={{ color: 'var(--wf-verified-ink)', fontSize: 14 }}>Bank details saved.</p>}
            <button type="button" className="btn-secondary" onClick={startEditBank}>
              {bank ? 'Change bank details' : 'Add bank details'}
            </button>
          </>
        )}

        {editingBank && (
          <form onSubmit={saveBank}>
            {BANK_DETAIL_FIELDS.map((f) => (
              <div key={f.key}>
                <label>{f.label}</label>
                <input
                  type={f.type}
                  inputMode={f.inputMode}
                  value={bankForm[f.key]}
                  onChange={(e) => setBankForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  autoComplete={f.autoComplete || 'off'}
                />
              </div>
            ))}
            <p style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              Check the digits against your bank card or app before saving. A wrong number means a payment that does not arrive.
            </p>
            {bankError && <p style={{ color: 'var(--wf-overdue)', fontSize: 14 }}>{bankError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={() => setEditingBank(false)} disabled={savingBank}>Cancel</button>
              <button type="submit" disabled={savingBank}>{savingBank ? 'Saving...' : (bank ? 'Replace bank details' : 'Save bank details')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
