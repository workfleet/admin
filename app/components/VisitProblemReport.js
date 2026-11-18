'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { compressImage } from '../../lib/compressImage';

// "Something wasn't right?" on a past visit in the client portal. Sends a
// client request (0057) of kind 'problem' tied to this visit, with optional
// photos (0147), so the office gets it with the visit and cleaner attached
// instead of as a loose message. The client then sees it here as "with us"
// and, once the office closes it, what was done about it.

const MAX_PHOTOS = 6;

export default function VisitProblemReport({ jobId, clientId }) {
  const [reports, setReports] = useState(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const { data } = await supabase
      .from('client_requests')
      .select('id, description, status, resolution_note, created_at, photo_paths')
      .eq('job_id', jobId)
      .eq('kind', 'problem')
      .order('created_at', { ascending: false });
    setReports(data || []);
  };

  useEffect(() => { if (jobId) load(); }, [jobId]);

  const pickFiles = (e) => {
    const picked = Array.from(e.target.files || []).filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => [...prev, ...picked].slice(0, MAX_PHOTOS));
    e.target.value = '';
  };

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || !clientId) return;
    setSending(true);
    setError('');

    const paths = [];
    for (const [i, file] of files.entries()) {
      const small = await compressImage(file);
      const path = `${clientId}/${jobId}/${Date.now()}-${i}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('client-problem-photos')
        .upload(path, small, { contentType: 'image/jpeg' });
      if (uploadError) {
        setSending(false);
        setError("A photo didn't upload - check your signal and try again, or send it without photos.");
        return;
      }
      paths.push(path);
    }

    const { data: { session } } = await supabase.auth.getSession();
    const { error: insertError } = await supabase.from('client_requests').insert({
      client_id: clientId,
      job_id: jobId,
      kind: 'problem',
      description: text.trim(),
      photo_paths: paths,
      created_by: session?.user?.id,
    });

    setSending(false);
    if (insertError) {
      setError("That didn't send - please try again, or message us instead.");
      return;
    }
    setText('');
    setFiles([]);
    setOpen(false);
    load();
  };

  if (reports === null) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2>Something wasn&rsquo;t right?</h2>

      {reports.map((r) => (
        <div key={r.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 13.5 }}>{r.description}</span>
            <span className={`badge ${r.status === 'resolved' ? 'completed' : 'scheduled'}`} style={{ alignSelf: 'flex-start', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {r.status === 'resolved' ? 'sorted' : 'with us'}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            Reported {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            {r.photo_paths?.length > 0 && ` · ${r.photo_paths.length} photo${r.photo_paths.length === 1 ? '' : 's'}`}
          </div>
          {r.status === 'resolved' && r.resolution_note && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', fontStyle: 'italic', marginTop: 4 }}>&ldquo;{r.resolution_note}&rdquo;</div>
          )}
        </div>
      ))}

      {!open && (
        <>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: reports.length ? '12px 0' : '4px 0 12px' }}>
            Something missed or not up to standard? Tell us here and we&rsquo;ll put it right. It goes straight to the office with this visit attached.
          </p>
          <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
            <AlertTriangle size={16} style={{ marginRight: 6, verticalAlign: '-3px' }} />
            Report a problem
          </button>
        </>
      )}

      {open && (
        <form onSubmit={send} style={{ marginTop: reports.length ? 12 : 4 }}>
          <label className="field-label" htmlFor="problem-text">What wasn&rsquo;t right?</label>
          <textarea
            id="problem-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. The kitchen bins weren't emptied"
            rows={3}
            autoFocus
            style={{
              width: '100%', padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: 10,
              background: 'var(--wf-ash)', fontSize: 14, fontFamily: 'inherit', margin: '4px 0 10px', resize: 'vertical',
            }}
          />

          <label className="field-label" htmlFor="problem-photos">Photos (optional, up to {MAX_PHOTOS})</label>
          {files.length < MAX_PHOTOS && (
            <input id="problem-photos" type="file" accept="image/*" multiple onChange={pickFiles} disabled={sending} style={{ margin: '4px 0 8px' }} />
          )}
          {files.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {f.name.length > 18 ? `${f.name.slice(0, 15)}...` : f.name}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 0, padding: 0, minHeight: 0, color: 'inherit', cursor: 'pointer', display: 'inline-flex' }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && <p style={{ color: 'var(--wf-overdue)', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-secondary" onClick={() => { setOpen(false); setError(''); }} disabled={sending}>Cancel</button>
            <button type="submit" disabled={sending || !text.trim()}>
              {sending ? (files.length ? 'Sending photos...' : 'Sending...') : 'Send to the office'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
