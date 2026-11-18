'use client';

import { useEffect, useState } from 'react';
import { User } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { compressImage } from '../../lib/compressImage';
import { useToast } from './ToastProvider';

// A staff member's photo for the client portal's "Your cleaner" (0148).
// Clients see it only once the office records that this person agreed;
// until then it stays office-only. Clients only ever get their first name
// and, from Certifications, whether they hold an in-date DBS check.
export default function StaffPhotoCard({ staffId, fullName }) {
  const toast = useToast();
  const [photoPath, setPhotoPath] = useState(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const sign = async (path) => {
    if (!path) { setUrl(null); return; }
    const { data } = await supabase.storage.from('staff-photos').createSignedUrl(path, 3600);
    setUrl(data?.signedUrl || null);
  };

  useEffect(() => {
    if (!staffId) return;
    (async () => {
      const { data } = await supabase.from('profiles').select('photo_path, photo_visible_to_clients').eq('id', staffId).single();
      setPhotoPath(data?.photo_path || null);
      setVisible(!!data?.photo_visible_to_clients);
      await sign(data?.photo_path);
      setLoaded(true);
    })();
  }, [staffId]);

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    const small = await compressImage(file, 600, 0.8);
    const path = `${staffId}/photo-${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage.from('staff-photos').upload(path, small, { contentType: 'image/jpeg' });
    if (upErr) { setBusy(false); toast.error("Couldn't upload the photo."); return; }
    const old = photoPath;
    const { error } = await supabase.from('profiles').update({ photo_path: path }).eq('id', staffId);
    if (error) { setBusy(false); toast.error("Uploaded, but couldn't save it to their profile."); return; }
    if (old) await supabase.storage.from('staff-photos').remove([old]);
    setPhotoPath(path);
    await sign(path);
    setBusy(false);
    toast.success('Photo saved.');
  };

  const setAgreed = async (next) => {
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ photo_visible_to_clients: next }).eq('id', staffId);
    setBusy(false);
    if (error) { toast.error("Couldn't save that."); return; }
    setVisible(next);
  };

  const removePhoto = async () => {
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ photo_path: null, photo_visible_to_clients: false }).eq('id', staffId);
    if (!error && photoPath) await supabase.storage.from('staff-photos').remove([photoPath]);
    setBusy(false);
    if (error) { toast.error("Couldn't remove it."); return; }
    setPhotoPath(null);
    setVisible(false);
    setUrl(null);
  };

  if (!loaded) return null;
  const first = (fullName || '').trim().split(/\s+/)[0] || 'they';

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>Photo for clients</h2>
      <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 12px' }}>
        Clients see their cleaner&rsquo;s first name on each visit, with &ldquo;DBS checked&rdquo; if Certifications has an in-date DBS. A photo is added only if {first} agrees.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {url
          ? <img src={url} alt={fullName || 'Staff photo'} className="visit-cleaner-photo" style={{ width: 72, height: 72 }} />
          : <div className="visit-cleaner-photo visit-cleaner-photo-empty" style={{ width: 72, height: 72 }} aria-hidden="true"><User size={30} /></div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="btn-secondary" style={{ display: 'inline-block', cursor: busy ? 'default' : 'pointer', textAlign: 'center' }}>
            {busy ? 'Saving...' : photoPath ? 'Change photo' : 'Add photo'}
            <input type="file" accept="image/*" onChange={upload} disabled={busy} style={{ display: 'none' }} />
          </label>
          {photoPath && <button type="button" className="btn-secondary" onClick={removePhoto} disabled={busy}>Remove photo</button>}
        </div>
      </div>
      {photoPath && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14, fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={visible} onChange={(e) => setAgreed(e.target.checked)} disabled={busy} style={{ width: 'auto', marginTop: 3 }} />
          <span>
            {first} has agreed to clients seeing this photo
            <span style={{ display: 'block', fontSize: 12.5, color: 'var(--muted)' }}>Only clients they&rsquo;re booked to clean for will see it. Untick if they change their mind.</span>
          </span>
        </label>
      )}
    </div>
  );
}
