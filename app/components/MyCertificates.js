'use client';

import { useEffect, useRef, useState } from 'react';
import { Award, Upload, Eye } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useConfirm } from './ConfirmProvider';
import { useToast } from './ToastProvider';

// Staff add their own certificates (DBS, training, food hygiene...) with a
// photo or PDF. Rows go in staff_certifications (0050, file columns 0152)
// so the office sees them on the person's Certifications card and in the
// dashboard's expiring list.
const MAX_BYTES = 15 * 1024 * 1024;

function isExpired(date) {
  return date && new Date(date) < new Date(new Date().toDateString());
}

export default function MyCertificates() {
  const confirm = useConfirm();
  const toast = useToast();
  const fileRef = useRef(null);
  const [userId, setUserId] = useState(null);
  const [certs, setCerts] = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;
    setUserId(uid);
    const { data, error } = await supabase
      .from('staff_certifications')
      .select('id, name, expiry_date, storage_path, file_name, created_by')
      .eq('staff_id', uid)
      .order('expiry_date', { ascending: true, nullsFirst: false });
    if (error) { setCerts([]); return; }
    setCerts(data || []);
  };

  const reset = () => {
    setAdding(false);
    setName('');
    setExpiry('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const pickFile = (e) => {
    const f = e.target.files?.[0] || null;
    if (f && f.size > MAX_BYTES) {
      toast.error('That file is over 15 MB - try a photo instead of a scan, or a smaller PDF.');
      e.target.value = '';
      setFile(null);
      return;
    }
    setFile(f);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim() || !file || !userId) return;
    setSaving(true);
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const storagePath = `${userId}/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from('staff-certificates').upload(storagePath, file, { contentType: file.type || undefined });
    if (upErr) {
      setSaving(false);
      toast.error(navigator.onLine === false ? 'No signal - try again when you have a connection.' : 'Could not upload the file. Photos and PDFs only, up to 15 MB.');
      return;
    }
    const { data, error } = await supabase
      .from('staff_certifications')
      .insert({
        staff_id: userId,
        created_by: userId,
        name: name.trim(),
        expiry_date: expiry || null,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
      })
      .select('id, name, expiry_date, storage_path, file_name, created_by')
      .single();
    setSaving(false);
    if (error) {
      await supabase.storage.from('staff-certificates').remove([storagePath]);
      toast.error('Could not save the certificate - please try again.');
      return;
    }
    setCerts((prev) => [...(prev || []), data].sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999')));
    toast.success('Certificate sent to the office.');
    reset();
  };

  const view = async (c) => {
    const { data } = await supabase.storage.from('staff-certificates').createSignedUrl(c.storage_path, 600);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    else toast.error('Could not open the file.');
  };

  const remove = async (c) => {
    if (!(await confirm(`Remove "${c.name}"? The office will no longer have it on file.`, { danger: true }))) return;
    const { error } = await supabase.from('staff_certifications').delete().eq('id', c.id);
    if (error) { toast.error('Could not remove it.'); return; }
    if (c.storage_path) await supabase.storage.from('staff-certificates').remove([c.storage_path]);
    setCerts((prev) => prev.filter((x) => x.id !== c.id));
    toast.success('Certificate removed.');
  };

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h2>My certificates</h2>
      <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 10px' }}>
        Upload a photo or PDF of any certificate - DBS, training, food hygiene, first aid. The office can see them on your record.
      </p>

      {certs?.map((c) => {
        const expired = isExpired(c.expiry_date);
        const mine = c.created_by === userId;
        return (
          <div key={c.id} className="task-row" style={{ justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <Award size={18} color="var(--muted)" style={{ flexShrink: 0 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: expired ? 'var(--wf-overdue)' : 'var(--muted)' }}>
                  {c.expiry_date ? `${expired ? 'Expired' : 'Expires'} ${new Date(c.expiry_date).toLocaleDateString()}` : 'No expiry date'}
                  {!mine && ' · added by the office'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {c.storage_path && (
                <button type="button" className="btn-secondary" onClick={() => view(c)} aria-label={`View ${c.name}`}>
                  <Eye size={16} />
                </button>
              )}
              {mine && (
                <button type="button" className="btn-secondary" onClick={() => remove(c)}>Remove</button>
              )}
            </div>
          </div>
        );
      })}

      {adding ? (
        <form onSubmit={save} style={{ marginTop: 12 }}>
          <label htmlFor="cert-name">What is it?</label>
          <input id="cert-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DBS check, Food hygiene level 2" required autoFocus />
          <label htmlFor="cert-expiry">Expiry date (if it has one)</label>
          <input id="cert-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          <label htmlFor="cert-file">Photo or PDF</label>
          <input id="cert-file" ref={fileRef} type="file" accept="image/*,application/pdf" onChange={pickFile} required />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn-secondary" onClick={reset} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving || !file || !name.trim()}>
              {saving ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setAdding(true)} style={{ marginTop: certs?.length ? 12 : 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Upload size={16} /> Upload a certificate
        </button>
      )}
    </div>
  );
}
