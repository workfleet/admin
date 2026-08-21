'use client';

import { useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { notify } from '../../lib/notify';
import { useConfirm } from './ConfirmProvider';
import { useToast } from './ToastProvider';

// Why a claim didn't go through. The database decides — these just put
// its answer in plain English, so nobody is left guessing why the button
// didn't work.
const CLAIM_MESSAGES = {
  already_taken: 'Someone else got there first.',
  expired: 'That cover request has closed.',
  too_late: 'That shift has already started.',
  already_on_job: "You're already on that shift.",
  on_time_off: "You've got approved time off that day.",
  clashes: 'That clashes with another shift you\'re already on.',
  not_eligible: "Your account can't pick up cover shifts — check with the office.",
  not_found: 'That shift is no longer available.',
};

const formatWhen = (value) =>
  new Date(value).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function ShiftCoverCard({ userId, onChange }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [offers, setOffers] = useState([]);
  const [declinedIds, setDeclinedIds] = useState([]);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!userId) return;
    load();
  }, [userId]);

  const load = async () => {
    const [{ data: offerRows }, { data: responseRows }] = await Promise.all([
      supabase
        .from('shift_offers')
        .select(
          'id, job_id, reason, released_by, expires_at, created_at,'
          + ' jobs(scheduled_at, duration_minutes, properties(address)),'
          + ' releaser:profiles!shift_offers_released_by_fkey(full_name)'
        )
        .eq('status', 'open')
        .order('created_at', { ascending: false }),
      supabase.from('shift_offer_responses').select('offer_id').eq('cleaner_id', userId).eq('response', 'declined'),
    ]);

    // Drop anything whose job didn't come back with it — an offer whose
    // shift has since been deleted has nothing to show and nothing to claim.
    setOffers(
      (offerRows || []).filter((o) => o.jobs && (!o.expires_at || new Date(o.expires_at) > new Date()))
    );
    setDeclinedIds((responseRows || []).map((r) => r.offer_id));
  };

  const accept = async (offer) => {
    const ok = await confirm(
      `Take this shift on ${formatWhen(offer.jobs.scheduled_at)} at ${offer.jobs?.properties?.address}?`,
      { title: 'Pick up this shift' }
    );
    if (!ok) return;

    setBusyId(offer.id);
    const { data, error } = await supabase.rpc('claim_shift_offer', { target_offer_id: offer.id });
    setBusyId(null);

    if (error) { toast.error("Couldn't pick that up — try again."); return; }

    if (data !== 'ok') {
      toast.error(CLAIM_MESSAGES[data] || "Couldn't pick that up.");
      load();
      return;
    }

    setOffers((prev) => prev.filter((o) => o.id !== offer.id));
    toast.success("It's yours — it's on your rota now.");
    onChange?.();

    notify({
      type: 'shift_cover_filled',
      releasedByCleanerId: offer.released_by,
      address: offer.jobs?.properties?.address,
      scheduledAt: offer.jobs?.scheduled_at,
    });
  };

  const decline = async (offer) => {
    setBusyId(offer.id);
    await supabase
      .from('shift_offer_responses')
      .upsert({ offer_id: offer.id, cleaner_id: userId, response: 'declined' }, { onConflict: 'offer_id,cleaner_id' });
    setBusyId(null);
    setDeclinedIds((prev) => [...prev, offer.id]);
  };

  const cancelOwn = async (offer) => {
    const ok = await confirm('Withdraw your cover request? The shift stays yours.', {
      title: 'Withdraw request',
      danger: true,
    });
    if (!ok) return;

    setBusyId(offer.id);
    const { data, error } = await supabase.rpc('cancel_shift_offer', { target_offer_id: offer.id });
    setBusyId(null);

    if (error || data !== 'ok') {
      toast.error(data === 'already_taken' ? 'Someone has already covered it.' : "Couldn't withdraw that.");
      load();
      return;
    }

    setOffers((prev) => prev.filter((o) => o.id !== offer.id));
    toast.success('Cover request withdrawn — the shift is still yours.');
    onChange?.();
  };

  const mine = offers.filter((o) => o.released_by === userId);
  const available = offers.filter((o) => o.released_by !== userId && !declinedIds.includes(o.id));

  if (mine.length === 0 && available.length === 0) return null;

  return (
    <>
      {mine.length > 0 && (
        <div className="card">
          <h2>Your cover requests</h2>
          {mine.map((offer) => (
            <div key={offer.id} className="task-row" style={{ justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{formatWhen(offer.jobs.scheduled_at)}</div>
                <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{offer.jobs?.properties?.address}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Waiting for someone to pick it up — it's still your shift until they do.
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => cancelOwn(offer)}
                disabled={busyId === offer.id}
                style={{ flexShrink: 0 }}
                title="Take this shift back off the cover list - it stays yours"
              >
                Withdraw
              </button>
            </div>
          ))}
        </div>
      )}

      {available.length > 0 && (
        <div className="card" style={{ background: 'var(--wf-ash)' }}>
          <h2>Shifts needing cover ({available.length})</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '-4px 0 10px' }}>
            First to accept gets it.
          </p>
          {available.map((offer) => (
            <div key={offer.id} className="task-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <LifeBuoy size={18} color="var(--wf-steel)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{formatWhen(offer.jobs.scheduled_at)}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                    {offer.jobs?.properties?.address}
                    {offer.jobs?.duration_minutes && ` · ${offer.jobs.duration_minutes} mins`}
                  </div>
                  {offer.reason && (
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', marginTop: 2 }}>
                      "{offer.reason}"
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => accept(offer)}
                  disabled={busyId === offer.id}
                  style={{ flex: 1 }}
                  title="Take this shift on - it goes straight onto your rota"
                >
                  {busyId === offer.id ? 'Just a sec...' : "I'll take it"}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => decline(offer)}
                  disabled={busyId === offer.id}
                  style={{ flex: 1 }}
                  title="Hide this one - it stays available for everyone else"
                >
                  Not me
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
