'use client';

import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

// One site's access notes (door codes, key safe, alarm), where the client
// is already looking at that site: an upcoming visit, or the dashboard with
// a site picked. Same field as Settings (properties.client_access_notes,
// 0061) - clients may update only that column - and cleaners see it on the
// job.
export default function SiteAccessNotes({ propertyId, address = null }) {
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    setSaved(null);
    setEditing(false);
    (async () => {
      const { data } = await supabase.from('properties').select('client_access_notes').eq('id', propertyId).single();
      if (cancelled) return;
      setSaved(data?.client_access_notes || '');
      setDraft(data?.client_access_notes || '');
    })();
    return () => { cancelled = true; };
  }, [propertyId]);

  const save = async () => {
    setSaving(true);
    setError('');
    const value = draft.trim() || null;
    const { error: saveError } = await supabase.from('properties').update({ client_access_notes: value }).eq('id', propertyId);
    setSaving(false);
    if (saveError) { setError("Couldn't save - please try again."); return; }
    setSaved(value || '');
    setEditing(false);
  };

  if (saved === null) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="dash-panel-header">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <KeyRound size={18} aria-hidden="true" /> Getting in
        </h2>
        {!editing && (
          <button type="button" className="btn-secondary" onClick={() => { setDraft(saved); setEditing(true); }}>
            {saved ? 'Edit' : 'Add'}
          </button>
        )}
      </div>
      {address && <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 8px' }}>{address}</p>}

      {!editing && (saved
        ? <p style={{ fontSize: 14, margin: 0, whiteSpace: 'pre-wrap' }}>{saved}</p>
        : <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: 0 }}>No access notes yet. Add a door code, key safe or alarm details and your cleaner will see them on the day.</p>
      )}

      {editing && (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Alarm code 4521, key safe by the front door, code 0000"
            rows={3}
            autoFocus
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10, background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', marginBottom: 8, resize: 'vertical' }}
          />
          <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 8px' }}>Seen by our office and whoever is cleaning this property.</p>
          {error && <p style={{ color: 'var(--wf-overdue)', fontSize: 13, margin: '0 0 8px' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </>
      )}
    </div>
  );
}
