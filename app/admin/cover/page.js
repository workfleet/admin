'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LifeBuoy, Clock } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { notify } from '../../../lib/notify';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';
import { rankCandidates, isGoodMatch } from '../../../lib/coverRanking';

const formatWhen = (value) =>
  new Date(value).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function AdminCover() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

  const [offers, setOffers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [cleaners, setCleaners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState(null);

  const [showOpenForm, setShowOpenForm] = useState(false);
  const [openForm, setOpenForm] = useState({ job_id: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const [assigningOfferId, setAssigningOfferId] = useState(null);
  const [assignCleanerId, setAssignCleanerId] = useState('');
  // Ranked candidates per open offer (rank_cover_candidates, 0084), loaded
  // when the admin opens Assign on it.
  const [candidates, setCandidates] = useState({});
  const [candidatesLoading, setCandidatesLoading] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const [{ data: offerRows }, { data: jobRows }, { data: assignmentRows }, { data: cleanerRows }] = await Promise.all([
      supabase
        .from('shift_offers')
        .select(
          'id, job_id, reason, status, created_at, filled_at, cancelled_at, expires_at,'
          + ' jobs(scheduled_at, duration_minutes, status, properties(address, clients(name))),'
          + ' releaser:profiles!shift_offers_released_by_fkey(id, full_name),'
          + ' filler:profiles!shift_offers_filled_by_fkey(full_name)'
        )
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('jobs')
        .select('id, scheduled_at, duration_minutes, status, properties(address, clients(name))')
        .eq('status', 'scheduled')
        .gte('scheduled_at', new Date().toISOString())
        .order('scheduled_at')
        .limit(100),
      supabase.from('job_assignments').select('job_id, cleaner_id, profiles(full_name)'),
      supabase.from('profiles').select('id, full_name').eq('role', 'cleaner').eq('active', true).order('full_name'),
    ]);

    setOffers(offerRows || []);
    setJobs(jobRows || []);
    setAssignments(assignmentRows || []);
    setCleaners(cleanerRows || []);
    setLoading(false);
  };

  const assigneesFor = (jobId) => assignments.filter((a) => a.job_id === jobId);

  const loadCandidates = async (offer) => {
    setCandidatesLoading(offer.id);
    const { data } = await supabase.rpc('rank_cover_candidates', { target_offer_id: offer.id });
    setCandidates((prev) => ({
      ...prev,
      [offer.id]: rankCandidates(data || [], { jobMinutes: offer.jobs?.duration_minutes || 60 }),
    }));
    setCandidatesLoading(null);
  };

  const toggleAssign = (offer) => {
    const opening = assigningOfferId !== offer.id;
    setAssigningOfferId(opening ? offer.id : null);
    setAssignCleanerId('');
    if (opening && !candidates[offer.id]) loadCandidates(offer);
  };

  const openCoverRequest = async (e) => {
    e.preventDefault();
    if (!openForm.job_id) return;
    setSaving(true);

    const { data, error } = await supabase
      .from('shift_offers')
      .insert({
        job_id: openForm.job_id,
        opened_by: userId,
        reason: openForm.reason.trim() || null,
      })
      .select(
        'id, job_id, reason, status, created_at, filled_at, cancelled_at, expires_at,'
        + ' jobs(scheduled_at, duration_minutes, status, properties(address, clients(name))),'
        + ' releaser:profiles!shift_offers_released_by_fkey(id, full_name),'
        + ' filler:profiles!shift_offers_filled_by_fkey(full_name)'
      )
      .single();

    setSaving(false);
    if (error || !data) { toast.error("Couldn't open that cover request — there may already be one for this shift."); return; }

    setOffers((prev) => [data, ...prev]);
    setOpenForm({ job_id: '', reason: '' });
    setShowOpenForm(false);
    toast.success('Cover request opened — staff will be notified.');

    notify({
      type: 'shift_cover_needed',
      offerId: data.id,
      jobId: data.job_id,
      address: data.jobs?.properties?.address,
      scheduledAt: data.jobs?.scheduled_at,
      durationMinutes: data.jobs?.duration_minutes,
      reason: data.reason,
    });
  };

  const cancelOffer = async (offer) => {
    const ok = await confirm('Cancel this cover request? The shift stays with whoever is on it now.', {
      title: 'Cancel cover request',
      danger: true,
    });
    if (!ok) return;

    const { error } = await supabase
      .from('shift_offers')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', offer.id);

    if (error) { toast.error("Couldn't cancel that request."); return; }
    setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: 'cancelled' } : o)));
    toast.success('Cover request cancelled.');
  };

  // Admin filling it themselves, rather than waiting for someone to claim
  // it — same end state as claim_shift_offer(), done through the admin
  // policies since the RPC deliberately only lets a cleaner claim for
  // themselves.
  const assignCover = async (offer, chosenId = assignCleanerId) => {
    if (!chosenId) return;
    setSaving(true);

    if (offer.releaser?.id) {
      await supabase
        .from('job_assignments')
        .delete()
        .eq('job_id', offer.job_id)
        .eq('cleaner_id', offer.releaser.id);
    }

    const { error: assignError } = await supabase
      .from('job_assignments')
      .insert({ job_id: offer.job_id, cleaner_id: chosenId });

    if (assignError) {
      setSaving(false);
      toast.error("Couldn't assign that cleaner — they may already be on this job.");
      return;
    }

    const { error } = await supabase
      .from('shift_offers')
      .update({ status: 'filled', filled_by: chosenId, filled_at: new Date().toISOString() })
      .eq('id', offer.id);

    setSaving(false);
    if (error) { toast.error('Assigned, but the cover request stayed open — refresh and close it.'); return; }

    const cleaner = cleaners.find((c) => c.id === chosenId);
    setOffers((prev) =>
      prev.map((o) => (o.id === offer.id ? { ...o, status: 'filled', filler: { full_name: cleaner?.full_name }, filled_at: new Date().toISOString() } : o))
    );
    setAssigningOfferId(null);
    setAssignCleanerId('');
    toast.success(`${cleaner?.full_name || 'Cleaner'} is now on this shift.`);

    notify({
      type: 'shift_assigned',
      cleanerId: chosenId,
      address: offer.jobs?.properties?.address,
      scheduledAt: offer.jobs?.scheduled_at,
    });
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  const isLive = (o) => o.status === 'open' && (!o.expires_at || new Date(o.expires_at) > new Date());
  const openOffers = offers.filter(isLive);
  const closedOffers = offers.filter((o) => !isLive(o));

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Shift Cover</h1>
          <p className="page-subtitle">
            Shifts that need someone — the best matches are told first, and anyone free can take it
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowOpenForm((s) => !s)}
          title={showOpenForm ? 'Close the form without opening a request' : 'Offer one of your upcoming shifts out for cover'}
        >
          {showOpenForm ? 'Cancel' : 'Request Cover'}
        </button>
      </div>

      {showOpenForm && (
        <form className="card" onSubmit={openCoverRequest} style={{ marginBottom: 16 }}>
          <h2>Request cover for a shift</h2>
          <div className="field">
            <label className="field-label">Shift</label>
            <select
              value={openForm.job_id}
              onChange={(e) => setOpenForm({ ...openForm, job_id: e.target.value })}
              required
            >
              <option value="">Choose an upcoming shift...</option>
              {jobs.map((j) => {
                const staff = assigneesFor(j.id).map((a) => a.profiles?.full_name).filter(Boolean);
                return (
                  <option key={j.id} value={j.id}>
                    {formatWhen(j.scheduled_at)} — {j.properties?.address}
                    {staff.length > 0 ? ` (${staff.join(', ')})` : ' (nobody assigned)'}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Reason (optional)</label>
            <input
              value={openForm.reason}
              onChange={(e) => setOpenForm({ ...openForm, reason: e.target.value })}
              placeholder="e.g. Extra pair of hands needed, client asked for two"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            title="Offer this shift to every free cleaner - first to accept takes it"
          >
            {saving ? 'Opening...' : 'Open Cover Request'}
          </button>
        </form>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Needs cover ({openOffers.length})</h2>
        {openOffers.length === 0 && <p className="empty-state">Every shift is covered.</p>}
        {openOffers.map((offer) => (
          <div key={offer.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
                <LifeBuoy size={18} color="var(--wf-steel)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>
                    {offer.jobs ? formatWhen(offer.jobs.scheduled_at) : 'Shift removed'}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                    {offer.jobs?.properties?.address}
                    {offer.jobs?.properties?.clients?.name && ` · ${offer.jobs.properties.clients.name}`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    {offer.releaser?.full_name
                      ? `${offer.releaser.full_name} can't make it`
                      : 'Extra cover requested'}
                    {offer.reason && ` — "${offer.reason}"`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                    <Clock size={12} /> open since {formatWhen(offer.created_at)}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'flex-start' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => toggleAssign(offer)}
                  title="See who is the best fit for this shift and put someone on it"
                >
                  {assigningOfferId === offer.id ? 'Close' : 'Assign'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => cancelOffer(offer)}
                  title="Withdraw this cover request - the shift stays with whoever is on it now"
                >
                  Cancel
                </button>
              </div>
            </div>

            {assigningOfferId === offer.id && (
              <div style={{ background: 'var(--wf-ash)', borderRadius: 10, padding: 12 }}>
                {/* Best fits first, with the reasons, so the 6am decision is
                    "Bea has done this site nine times and is free" rather
                    than a scroll through an alphabetical list. */}
                <div style={{ marginBottom: 12 }}>
                  <div className="field-label" style={{ marginBottom: 6 }}>Best matches</div>
                  {candidatesLoading === offer.id && <p className="empty-state" style={{ margin: 0 }}>Working out who fits...</p>}
                  {candidatesLoading !== offer.id && candidates[offer.id] && (() => {
                    const ranked = candidates[offer.id];
                    const eligible = ranked.filter((c) => c.eligible).slice(0, 5);
                    const ineligible = ranked.filter((c) => !c.eligible);
                    if (eligible.length === 0) {
                      return <p className="empty-state" style={{ margin: 0 }}>Nobody is free for this one - everyone is either on it, away, or booked at that time.</p>;
                    }
                    return (
                      <>
                        {eligible.map((c, i) => (
                          <div key={c.cleaner_id} className="task-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 13.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                {c.full_name}
                                {i === 0 && isGoodMatch(c) && (
                                  <span className="badge completed" style={{ fontSize: 11 }}>Best fit</span>
                                )}
                                {c.declined && (
                                  <span className="badge missed" style={{ fontSize: 11 }}>Said no</span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                                {c.reasons.length > 0 ? c.reasons.map((r) => r.text).join(' · ') : 'No history to go on yet'}
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn-compact"
                              onClick={() => assignCover(offer, c.cleaner_id)}
                              disabled={saving}
                              style={{ flexShrink: 0 }}
                              title={`Put ${c.full_name} on this shift and close the request`}
                            >
                              Assign
                            </button>
                          </div>
                        ))}
                        {ineligible.length > 0 && (
                          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '8px 0 0' }}>
                            Not free: {ineligible.map((c) => `${c.full_name} (${c.ineligible_reason})`).join(', ')}
                          </p>
                        )}
                      </>
                    );
                  })()}
                </div>
                <div className="field">
                  <label className="field-label">Or choose anyone</label>
                  <select value={assignCleanerId} onChange={(e) => setAssignCleanerId(e.target.value)}>
                    <option value="">Choose a cleaner...</option>
                    {cleaners
                      .filter((c) => c.id !== offer.releaser?.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>{c.full_name}</option>
                      ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => assignCover(offer)}
                  disabled={saving || !assignCleanerId}
                  style={{ width: '100%' }}
                  title="Put this cleaner on the shift now and stop offering it to everyone else"
                >
                  {saving ? 'Assigning...' : 'Assign & Close Request'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {closedOffers.length > 0 && (
        <div className="card">
          <h2>Recently closed</h2>
          {closedOffers.map((offer) => (
            <div key={offer.id} className="task-row" style={{ justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {offer.jobs ? formatWhen(offer.jobs.scheduled_at) : 'Shift removed'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                  {offer.jobs?.properties?.address}
                  {offer.status === 'filled' && offer.filler?.full_name && ` · covered by ${offer.filler.full_name}`}
                </div>
              </div>
              <span className={`badge ${offer.status === 'filled' ? 'completed' : 'missed'}`}>
                {offer.status === 'filled' ? 'Covered' : offer.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
