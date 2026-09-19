'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { notify } from '../../lib/notify';
import { rankCandidates, isGoodMatch } from '../../lib/coverRanking';
import { useToast } from './ToastProvider';

// The best people to cover a shift, with one tap to put them on it. Shown
// on the Requests page the moment approved time off puts shifts out for
// cover, so the office can settle them there rather than waiting for a
// claim or walking over to the Cover page. Assigning does exactly what the
// Cover page's Assign does: the releaser comes off, the chosen cleaner goes
// on, the offer is marked filled, and the cleaner is told.

const fmtWhen = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function ShiftSuggestion({ offer, onFilled }) {
  const toast = useToast();
  const [ranked, setRanked] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('rank_cover_candidates', { target_offer_id: offer.id }).then(({ data }) => {
      if (!cancelled) setRanked(rankCandidates(data || [], { jobMinutes: offer.job?.duration_minutes || 60 }));
    });
    return () => { cancelled = true; };
  }, [offer.id]);

  const assign = async (candidate) => {
    setSaving(true);
    if (offer.released_by) {
      await supabase.from('job_assignments').delete().eq('job_id', offer.job_id).eq('cleaner_id', offer.released_by);
    }
    const { error: assignError } = await supabase.from('job_assignments').insert({ job_id: offer.job_id, cleaner_id: candidate.cleaner_id });
    if (assignError) { setSaving(false); toast.error("Couldn't assign them - they may already be on this job."); return; }

    const { error } = await supabase
      .from('shift_offers')
      .update({ status: 'filled', filled_by: candidate.cleaner_id, filled_at: new Date().toISOString() })
      .eq('id', offer.id);
    setSaving(false);
    if (error) { toast.error('Assigned, but the cover request stayed open - close it on the Cover page.'); return; }

    notify({ type: 'shift_assigned', cleanerId: candidate.cleaner_id, address: offer.job?.address, scheduledAt: offer.job?.scheduled_at });
    toast.success(`${candidate.full_name} is now on this shift.`);
    onFilled(offer.id, candidate.full_name);
  };

  const eligible = (ranked || []).filter((c) => c.eligible).slice(0, 3);

  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--hairline)' }}>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtWhen(offer.job?.scheduled_at)} · {offer.job?.address || 'Shift'}</div>
      {ranked === null && <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>Finding who's free...</p>}
      {ranked !== null && eligible.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0' }}>Nobody is free - it stays on Shifts to Cover for anyone who becomes available.</p>
      )}
      {eligible.map((c, i) => (
        <div key={c.cleaner_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '4px 0 4px 10px', borderLeft: '2px solid var(--hairline)', marginTop: 4 }}>
          <div style={{ minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{c.full_name}</span>
            {i === 0 && isGoodMatch(c) && <span className="badge completed" style={{ fontSize: 11, marginLeft: 6 }}>Best fit</span>}
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              {c.reasons.length > 0 ? c.reasons.slice(0, 2).map((r) => r.text).join(' · ') : 'No history to go on yet'}
            </div>
          </div>
          <button type="button" className="btn-compact" onClick={() => assign(c)} disabled={saving} style={{ flexShrink: 0 }} title={`Put ${c.full_name} on this shift and close the cover request`}>
            Assign
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * @param {object} props
 * @param {Array<{id: string, job_id: string, released_by: string|null, job: {scheduled_at: string, address: string, duration_minutes: number}}>} props.offers
 * @param {() => void} props.onDone
 */
export default function CoverSuggestions({ offers, onDone }) {
  const [filled, setFilled] = useState({});
  const remaining = offers.filter((o) => !filled[o.id]);

  return (
    <div className="card" style={{ marginTop: 10, padding: '10px 14px', background: 'var(--wf-ash)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontWeight: 600, margin: 0, fontSize: 13.5 }}>
            {remaining.length === 0 ? 'All covered' : `${offers.length} shift${offers.length === 1 ? '' : 's'} to cover`}
          </p>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 0' }}>
            {remaining.length === 0
              ? 'Every shift has someone on it.'
              : 'Assign someone now, or leave it and the first cleaner to claim it takes it.'}
          </p>
        </div>
        <button type="button" className="btn-compact" onClick={onDone}>{remaining.length === 0 ? 'Close' : 'Leave for claims'}</button>
      </div>
      {Object.entries(filled).map(([id, name]) => {
        const offer = offers.find((o) => o.id === id);
        return (
          <p key={id} style={{ fontSize: 12.5, margin: '6px 0 0', color: 'var(--wf-verified)' }}>
            {fmtWhen(offer?.job?.scheduled_at)} · {offer?.job?.address} - {name} is on it.
          </p>
        );
      })}
      {remaining.map((offer) => (
        <ShiftSuggestion key={offer.id} offer={offer} onFilled={(id, name) => setFilled((f) => ({ ...f, [id]: name }))} />
      ))}
    </div>
  );
}
