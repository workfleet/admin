'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';

export default function ClientSettings() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const [clientId, setClientId] = useState(null);
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsSaved, setDetailsSaved] = useState(false);

  const [properties, setProperties] = useState([]);
  const [accessNotesDraft, setAccessNotesDraft] = useState({});
  const [savingPropertyId, setSavingPropertyId] = useState(null);
  const [savedPropertyId, setSavedPropertyId] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase.from('profiles').select('client_id').eq('id', session.user.id).single();
    if (!profile?.client_id) { setLoading(false); return; }
    setClientId(profile.client_id);

    const [{ data: clientRow }, { data: propertiesData }] = await Promise.all([
      supabase.from('clients').select('contact_name, email, phone, billing_address').eq('id', profile.client_id).single(),
      supabase.from('properties').select('id, address, client_access_notes').eq('client_id', profile.client_id).order('address'),
    ]);

    setContactName(clientRow?.contact_name || '');
    setEmail(clientRow?.email || '');
    setPhone(clientRow?.phone || '');
    setBillingAddress(clientRow?.billing_address || '');

    setProperties(propertiesData || []);
    const drafts = {};
    (propertiesData || []).forEach((p) => { drafts[p.id] = p.client_access_notes || ''; });
    setAccessNotesDraft(drafts);

    setLoading(false);
  };

  const saveDetails = async (e) => {
    e.preventDefault();
    setSavingDetails(true);
    setDetailsSaved(false);

    const { error } = await supabase
      .from('clients')
      .update({
        contact_name: contactName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        billing_address: billingAddress.trim() || null,
      })
      .eq('id', clientId);

    setSavingDetails(false);
    if (!error) {
      setDetailsSaved(true);
      setTimeout(() => setDetailsSaved(false), 2500);
    }
  };

  const saveAccessNotes = async (propertyId) => {
    setSavingPropertyId(propertyId);
    setSavedPropertyId(null);

    const { error } = await supabase
      .from('properties')
      .update({ client_access_notes: accessNotesDraft[propertyId]?.trim() || null })
      .eq('id', propertyId);

    setSavingPropertyId(null);
    if (!error) {
      setSavedPropertyId(propertyId);
      setTimeout(() => setSavedPropertyId(null), 2500);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div className="page-header-row">
        <div>
          <h1>Settings</h1>
          <p className="page-subtitle">Your contact details and property access info</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Your Details</h2>
        <form onSubmit={saveDetails}>
          <label>Contact name</label>
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="e.g. Jane Smith" />

          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. jane@example.com" />

          <label>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 07700 900123" />

          <label>Billing address</label>
          <input value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} placeholder="Billing address" />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button type="submit" disabled={savingDetails}>{savingDetails ? 'Saving...' : 'Save Details'}</button>
            {detailsSaved && <span style={{ fontSize: 13, color: 'var(--brand-primary)' }}>Saved</span>}
          </div>
        </form>
      </div>

      <div className="card">
        <h2>Property Access Notes</h2>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 12px' }}>
          Alarm codes, key safe codes, or anything your cleaner needs to know to get in. This is shared with our office and whoever is assigned to clean each property.
        </p>

        {properties.length === 0 && <p className="empty-state">No properties on file yet.</p>}

        {properties.map((p) => (
          <div key={p.id} style={{ borderTop: '1px solid var(--hairline)', padding: '12px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{p.address}</div>
            <textarea
              value={accessNotesDraft[p.id] ?? ''}
              onChange={(e) => setAccessNotesDraft((prev) => ({ ...prev, [p.id]: e.target.value }))}
              placeholder="e.g. Alarm code 4521, key safe by the front door, code 0000"
              rows={2}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, background: '#f8fafc', fontSize: 14, fontFamily: 'inherit', marginBottom: 8, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn-secondary" onClick={() => saveAccessNotes(p.id)} disabled={savingPropertyId === p.id}>
                {savingPropertyId === p.id ? 'Saving...' : 'Save'}
              </button>
              {savedPropertyId === p.id && <span style={{ fontSize: 13, color: 'var(--brand-primary)' }}>Saved</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
