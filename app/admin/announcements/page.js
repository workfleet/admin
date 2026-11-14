'use client';

import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { withoutTestAccounts } from '../../../lib/testAccounts';
import { notify } from '../../../lib/notify';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

// Messages to every cleaner at once (0136). Each one pops up over the
// cleaner app the next time they open it, until they tap "Got it".
export default function AdminAnnouncements() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [myId, setMyId] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [reads, setReads] = useState([]);
  const [staff, setStaff] = useState([]);
  const [openId, setOpenId] = useState(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [ringBell, setRingBell] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setMyId(session.user.id);

    const [{ data: anns, error }, { data: staffRows }] = await Promise.all([
      supabase.from('announcements')
        .select('id, title, body, ring_bell, created_at, archived_at')
        .order('created_at', { ascending: false })
        .limit(20),
      supabase.from('profiles').select('id, full_name').in('role', ['cleaner', 'inventory']).eq('active', true).order('full_name'),
    ]);

    if (error) { setLoadError(true); setLoading(false); return; }

    // Only the reads for the messages on screen: 20 messages x the whole
    // staff stays well under the 1000-row cap on a single select.
    const ids = (anns || []).map((a) => a.id);
    const { data: readRows } = ids.length
      ? await supabase.from('announcement_reads').select('announcement_id, profile_id, read_at').in('announcement_id', ids)
      : { data: [] };
    setAnnouncements(anns || []);
    setReads(readRows || []);
    setStaff(withoutTestAccounts(staffRows));
    setLoading(false);
  };

  const send = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await confirm(
      `Send this to all ${staff.length} active staff? It will pop up when they next open the app${ringBell ? ', and go to the phones of anyone with alerts on' : ''}.`,
      { confirmLabel: 'Send' },
    );
    if (!ok) return;

    setSending(true);
    const { data, error } = await supabase
      .from('announcements')
      .insert({ title: title.trim(), body: body.trim(), ring_bell: ringBell, created_by: myId })
      .select('id, title, body, ring_bell, created_at, archived_at')
      .single();
    setSending(false);

    if (error || !data) { toast.error('Could not send the message. Please try again.'); return; }
    // The bell rows were written by trigger; push them to phones now
    // rather than waiting for the next sweep.
    if (ringBell) notify({ type: 'flush' });

    setAnnouncements((prev) => [data, ...prev]);
    setTitle('');
    setBody('');
    setRingBell(true);
    toast.success('Message sent to all staff.');
  };

  const stopShowing = async (ann) => {
    if (!(await confirm('Stop showing this message? Anyone who hasn\'t opened the app yet won\'t see it.'))) return;
    const archived_at = new Date().toISOString();
    const { error } = await supabase.from('announcements').update({ archived_at }).eq('id', ann.id);
    if (error) { toast.error('Could not update the message.'); return; }
    setAnnouncements((prev) => prev.map((a) => (a.id === ann.id ? { ...a, archived_at } : a)));
  };

  const showAgain = async (ann) => {
    const { error } = await supabase.from('announcements').update({ archived_at: null }).eq('id', ann.id);
    if (error) { toast.error('Could not update the message.'); return; }
    setAnnouncements((prev) => prev.map((a) => (a.id === ann.id ? { ...a, archived_at: null } : a)));
  };

  if (loading) return <PageSkeleton />;

  if (loadError) {
    return (
      <div className="page-inner">
        <BackButton />
        <h1>Announcements</h1>
        <p className="empty-state">Couldn't load announcements. If this is the first time, the 0136 database update may not have been run yet.</p>
      </div>
    );
  }

  const fmt = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Announcements</h1>
          <p className="page-subtitle">Send a message to every cleaner. It pops up the next time they open the app, until they tap "Got it".</p>
        </div>
      </div>

      <div className="card job-form-card">
        <div className="job-form-header">
          <h2>New message</h2>
        </div>
        <form onSubmit={send}>
          <div className="job-form-body">
            <div className="field">
              <label className="field-label">Headline</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Office closed on Boxing Day" maxLength={120} required />
            </div>
            <div className="field">
              <label className="field-label">Message</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="The detail - what's changing, when, and what they need to do." />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={ringBell} onChange={(e) => setRingBell(e.target.checked)} style={{ width: 'auto' }} />
              Also send a phone notification
            </label>
          </div>
          <div className="job-form-actions">
            <button type="submit" className="btn-primary" disabled={sending || !title.trim()}>
              {sending ? 'Sending...' : `Send to all staff (${staff.length})`}
            </button>
          </div>
        </form>
      </div>

      <h2 style={{ fontSize: 15, margin: '24px 0 10px' }}>Sent</h2>
      {announcements.length === 0 && <p className="empty-state">Nothing sent yet.</p>}

      {announcements.map((ann) => {
        const seenBy = new Map(reads.filter((r) => r.announcement_id === ann.id).map((r) => [r.profile_id, r.read_at]));
        const seenStaff = staff.filter((s) => seenBy.has(s.id));
        const notSeen = staff.filter((s) => !seenBy.has(s.id));
        const open = openId === ann.id;

        return (
          <div key={ann.id} className="card" style={{ marginBottom: 12, opacity: ann.archived_at ? 0.7 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <strong>{ann.title}</strong>
                <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
                  {fmt(ann.created_at)}{ann.archived_at ? ' · no longer showing' : ''}
                </div>
              </div>
              {ann.archived_at
                ? <button className="btn-secondary" onClick={() => showAgain(ann)}>Show again</button>
                : <button className="btn-secondary" onClick={() => stopShowing(ann)}>Stop showing</button>}
            </div>
            {ann.body && <p style={{ whiteSpace: 'pre-wrap', margin: '10px 0 0', fontSize: 14 }}>{ann.body}</p>}
            <button
              type="button"
              className="btn-link"
              onClick={() => setOpenId(open ? null : ann.id)}
              style={{ marginTop: 10, padding: 0, background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: 14 }}
            >
              Seen by {seenStaff.length} of {staff.length} {open ? '▲' : '▼'}
            </button>
            {open && (
              <div style={{ marginTop: 8, fontSize: 14 }}>
                <div style={{ marginBottom: 6 }}>
                  <span style={{ color: 'var(--muted)' }}>Not seen yet: </span>
                  {notSeen.length === 0 ? 'everyone has seen it' : notSeen.map((s) => s.full_name || 'Unnamed').join(', ')}
                </div>
                {seenStaff.length > 0 && (
                  <div>
                    <span style={{ color: 'var(--muted)' }}>Seen: </span>
                    {seenStaff.map((s) => `${s.full_name || 'Unnamed'} (${fmt(seenBy.get(s.id))})`).join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
