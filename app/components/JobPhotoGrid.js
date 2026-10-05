'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { buildZip, photoFileName, saveBlob } from '../../lib/photoDownload';

// Staff job photos on the admin side, each with its own download button and
// a "Download all" that saves them as one zip. photos: [{ id, url (storage
// path), caption, signedUrl }]; namePrefix names the saved files.
export default function JobPhotoGrid({ photos, namePrefix }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const visible = photos.filter((p) => p.signedUrl);

  const fetchBytes = async (p) => {
    const res = await fetch(p.signedUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  };

  const downloadOne = async (p, i) => {
    setError('');
    try {
      saveBlob(await fetchBytes(p), photoFileName(namePrefix, p.url, i));
    } catch {
      // Fall back to opening it, so a long-press / right-click save still works.
      window.open(p.signedUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const downloadAll = async () => {
    setBusy(true);
    setError('');
    try {
      const files = [];
      for (let i = 0; i < visible.length; i++) {
        const blob = await fetchBytes(visible[i]);
        files.push({ name: photoFileName(namePrefix, visible[i].url, i), bytes: new Uint8Array(await blob.arrayBuffer()) });
      }
      saveBlob(new Blob([buildZip(files)], { type: 'application/zip' }), `${namePrefix || 'Job'} photos.zip`);
    } catch {
      setError("Couldn't download the photos - try again, or save them one at a time.");
    }
    setBusy(false);
  };

  if (visible.length === 0) return null;

  return (
    <div>
      {visible.length > 1 && (
        <button type="button" className="btn-secondary" onClick={downloadAll} disabled={busy} style={{ marginTop: 6 }}
          title="Save every photo for this job as one zip file">
          <Download size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          {busy ? 'Preparing…' : `Download all (${visible.length})`}
        </button>
      )}
      {error && <p style={{ color: 'var(--wf-overdue)', fontSize: 13, margin: '6px 0 0' }}>{error}</p>}
      <div className="photo-grid">
        {visible.map((p, i) => (
          <div key={p.id} className="photo-tile">
            <img
              src={p.signedUrl}
              alt={p.caption || 'job photo'}
              onClick={() => window.open(p.signedUrl, '_blank', 'noopener,noreferrer')}
              style={{ cursor: 'pointer' }}
            />
            <button type="button" className="photo-download" onClick={() => downloadOne(p, i)}
              title="Download this photo" aria-label="Download this photo">
              <Download size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
