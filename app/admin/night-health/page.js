'use client';

import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionAndProfile } from '../../../lib/authGate';
import { localDateString } from '../../../lib/localDate';
import BackButton from '../../components/BackButton';
import { useToast } from '../../components/ToastProvider';
import { Answers, ReviewForm } from '../../components/NightHealthReview';
import {
  QUESTIONS, OUTCOME_LABELS, RETENTION_NOTE, COLUMNS,
  yesAnswers, latestByPerson, standing, formatDay,
} from '../../../lib/nightHealth';

// Night worker health questionnaires (0143). Admins only: the database
// returns nothing to anyone else, and this sends supervisors home. Embeds are
// hinted so a second FK to profiles later can't break them (0094/0095).
const Q_SELECT = `${COLUMNS}, person:profiles!night_health_questionnaires_profile_id_fkey(full_name)`;
const W_SELECT = 'profile_id, added_at, person:profiles!night_workers_profile_id_fkey(full_name)';

const STANDING = {
  none: { label: 'Not sent yet', badge: 'missed' },
  waiting: { label: 'To review', badge: 'in_progress' },
  due: { label: 'Review due', badge: 'missed' },
  done: { label: 'Up to date', badge: 'completed' },
};


export default function AdminNightHealth() {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [rows, setRows] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [adding, setAdding] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    const { session, profile } = await getSessionAndProfile();
    if (!session) { router.push('/'); return; }
    if (profile?.role !== 'admin') { router.push('/admin'); return; }
    const [{ data: qs, error: qError }, { data: ws, error: wError }, { data: people }] = await Promise.all([
      supabase.from('night_health_questionnaires').select(Q_SELECT).order('submitted_at', { ascending: false }),
      supabase.from('night_workers').select(W_SELECT),
      supabase.from('profiles').select('id, full_name, role, active').neq('role', 'client').order('full_name'),
    ]);
    if (qError || wError) { setLoadError(true); setLoading(false); return; }
    setRows(qs || []);
    setWorkers(ws || []);
    setStaff(people || []);
    setLoading(false);
    const id = new URLSearchParams(window.location.search).get('id');
    if (id) setOpenId(id);
  };

  const names = useMemo(() => Object.fromEntries(staff.map((p) => [p.id, p.full_name])), [staff]);
  const latest = useMemo(() => latestByPerson(rows), [rows]);
  const today = localDateString(new Date());
  const workerIds = new Set(workers.map((w) => w.profile_id));
  const addable = staff.filter((p) => p.active !== false && !workerIds.has(p.id));
  const toReview = rows.filter((r) => !r.outcome).length;

  const addWorker = async () => {
    if (!adding) return;
    const { data, error } = await supabase.from('night_workers').insert({ profile_id: adding }).select(W_SELECT).single();
    if (error || !data) { toast.error("Couldn't add them. Try again in a moment."); return; }
    setWorkers((prev) => [...prev, data]);
    setAdding('');
    toast.success(`${data.person?.full_name || 'They'} will be asked to fill it in on their Home tab.`);
  };

  const removeWorker = async (w) => {
    const { error } = await supabase.from('night_workers').delete().eq('profile_id', w.profile_id);
    if (error) { toast.error("Couldn't remove them. Try again in a moment."); return; }
    setWorkers((prev) => prev.filter((x) => x.profile_id !== w.profile_id));
  };

  if (loading) return <PageSkeleton className="container" rows={3} />;

  if (loadError) {
    return (
      <div className="container">
        <BackButton />
        <h1>Night worker health</h1>
        <div className="card">
          <p style={{ margin: 0 }}>Couldn't load the questionnaires. If this is the first time, the 0143 database update may not have been run yet.</p>
        </div>
      </div>
    );
  }

  const sortedWorkers = [...workers].sort((a, b) => (a.person?.full_name || '').localeCompare(b.person?.full_name || ''));

  return (
    <div className="container">
      <BackButton />
      <p style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <Lock size={13} /> Confidential health data · admins only
      </p>
      <h1 style={{ marginTop: 0 }}>Night worker health</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
        Night workers must be offered a free health assessment before they start nights and regularly after that
        (Working Time Regulations 1998). Staff fill in the questionnaire on their phones; review each one here.
      </p>

      <div className="card">
        <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Who works nights</h2>
        <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: '0 0 10px' }}>
          People on this list are asked on their Home tab until they send one, and again when their next review is due.
          Anyone can still fill it in from Help → Company policies.
        </p>
        {sortedWorkers.length === 0 && <p style={{ fontSize: 14, margin: '0 0 10px' }}>Nobody yet.</p>}
        {sortedWorkers.map((w) => {
          const s = standing(latest[w.profile_id], today);
          const next = latest[w.profile_id]?.next_review_due;
          return (
            <div key={w.profile_id} className="task-row" style={{ gap: 10, alignItems: 'center' }}>
              <span style={{ flex: 1, fontSize: 14 }}>
                <strong>{w.person?.full_name || 'Unknown'}</strong>
                {next && <span style={{ color: 'var(--muted)' }}> · next review by {formatDay(next)}</span>}
              </span>
              <span className={`badge ${STANDING[s].badge}`}>{STANDING[s].label}</span>
              <button type="button" className="btn-secondary" onClick={() => removeWorker(w)} style={{ padding: '6px 10px', fontSize: 13 }}>
                Remove
              </button>
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-start' }}>
          <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Add a night worker" style={{ flex: 1 }}>
            <option value="">Add someone who works nights…</option>
            {addable.map((p) => <option key={p.id} value={p.id}>{p.full_name || 'Unnamed'}</option>)}
          </select>
          <button type="button" onClick={addWorker} disabled={!adding}>Add</button>
        </div>
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>
          Questionnaires{toReview > 0 ? ` · ${toReview} to review` : ''}
        </h2>
        {rows.length === 0 && <p style={{ fontSize: 14, margin: 0, color: 'var(--muted)' }}>None sent yet.</p>}
        {rows.map((q) => (
          <div key={q.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <button
              type="button"
              onClick={() => setOpenId(openId === q.id ? null : q.id)}
              title={openId === q.id ? 'Hide the answers' : 'Show the answers'}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left', width: '100%', boxShadow: 'none' }}
            >
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{q.person?.full_name || 'Unknown'} · {formatDay(q.signed_on)}</span>
                <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)' }}>
                  {q.wants_assessment ? 'Wants an assessment' : "Doesn't want one now"} · Yes to {yesAnswers(q).length} of {QUESTIONS.length}
                  {q.outcome ? ` · ${OUTCOME_LABELS[q.outcome]}` : ''}
                </span>
              </span>
              <span className={`badge ${q.outcome ? 'completed' : 'in_progress'}`}>{q.outcome ? 'Reviewed' : 'To review'}</span>
            </button>
            {openId === q.id && (
              <>
                <Answers q={q} reviewerName={names[q.reviewed_by]} />
                <ReviewForm q={q} select={Q_SELECT} onSaved={(row) => setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)))} />
              </>
            )}
          </div>
        ))}
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '12px 0 0' }}>{RETENTION_NOTE}</p>
      </div>
    </div>
  );
}
