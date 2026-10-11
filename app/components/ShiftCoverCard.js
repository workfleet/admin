'use client';

import { useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { notify } from '../../lib/notify';
import { useConfirm } from './ConfirmProvider';
import { useToast } from './ToastProvider';
import { rankCandidates, isGoodMatch } from '../../lib/coverRanking';
import { liveOffers, splitOffers } from '../../lib/shiftOffers';

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
  already_requested: "You've already asked for that one — the office will let you know.",
};

// What this cleaner has said about each offer (shift_offer_responses).
// "Not me" and an ask the office turned down both hide the offer; an ask
// still waiting shows it with its own state.
export function responsesByKind(rows) {
  const hidden = [];
  const requested = [];
  (rows || []).forEach((r) => {
    if (r.response === 'declined' || r.response === 'turned_down') hidden.push(r.offer_id);
    if (r.response === 'requested') requested.push(r.offer_id);
  });
  return { hidden, requested };
}

const formatWhen = (value) =>
  new Date(value).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// The two reads behind the card, exported so the home page can run them
// up front and hand the rows in as `preloaded`.
//
// Open offers come from open_cover_shifts() (0124) rather than a select
// with a jobs embed: a cleaner can't read the job or property of a shift
// they aren't on, so the embed came back empty and every offer but their
// own was dropped. Rows are reshaped to the embed's shape the card uses.
export async function fetchOpenOffers() {
  const { data, error } = await supabase.rpc('open_cover_shifts');
  // Until 0124 is run, fall back to the old read so a cleaner at least
  // keeps seeing their own cover requests.
  if (error) {
    return supabase
      .from('shift_offers')
      .select(
        'id, job_id, reason, released_by, expires_at, created_at,'
        + ' jobs(scheduled_at, duration_minutes, properties(address)),'
        + ' releaser:profiles!shift_offers_released_by_fkey(full_name)'
      )
      .eq('status', 'open')
      .order('created_at', { ascending: false });
  }
  return {
    error,
    data: (data || []).map((r) => ({
      id: r.id,
      job_id: r.job_id,
      reason: r.reason,
      released_by: r.released_by,
      expires_at: r.expires_at,
      created_at: r.created_at,
      jobs: { scheduled_at: r.scheduled_at, duration_minutes: r.duration_minutes, properties: { address: r.address } },
      releaser: r.releaser_name ? { full_name: r.releaser_name } : null,
    })),
  };
}

export function fetchMyResponses(userId) {
  return supabase.from('shift_offer_responses').select('offer_id, response').eq('cleaner_id', userId);
}

// `preloaded` (optional) is { offerRows, responseRows } the page already
// fetched, so the card's first render needs no round trip of its own and
// nothing above it moves once it arrives. `onCounts` (optional) is told
// { mine, available } whenever the offers on show change, so a pill above
// can stay in step after a "Not me" or a claim.
export default function ShiftCoverCard({ userId, onChange, onCounts, preloaded }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [offers, setOffers] = useState([]);
  const [declinedIds, setDeclinedIds] = useState([]);
  // Offers this cleaner has asked for and the office has not answered yet.
  const [requestedIds, setRequestedIds] = useState([]);
  const [busyId, setBusyId] = useState(null);
  // How well each open offer fits this cleaner, from rank_cover_candidates
  // (0084) - which, for a cleaner, returns only their own row. Used to put
  // the shift they have done before at the top and say why.
  const [fits, setFits] = useState({});

  useEffect(() => {
    if (!userId) return;
    load(preloaded);
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!onCounts) return;
    const { mine, available } = splitOffers(offers, declinedIds, userId);
    onCounts({ mine: mine.length, available: available.length });
  }, [offers, declinedIds, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // `seed` is the page's copy of the rows for the first load; a reload
  // after a failed claim always goes back to the database.
  const load = async (seed) => {
    const [{ data: offerRows }, { data: responseRows }] = seed
      ? [{ data: seed.offerRows }, { data: seed.responseRows }]
      : await Promise.all([fetchOpenOffers(), fetchMyResponses(userId)]);

    const live = liveOffers(offerRows);
    setOffers(live);
    const { hidden, requested } = responsesByKind(responseRows);
    setDeclinedIds(hidden);
    setRequestedIds(requested);

    // Best effort: an offer with no fit row simply shows without a badge.
    const fitRows = await Promise.all(
      live
        .filter((o) => o.released_by !== userId)
        .map(async (o) => {
          const { data } = await supabase.rpc('rank_cover_candidates', { target_offer_id: o.id });
          const [own] = rankCandidates(data || [], { jobMinutes: o.jobs?.duration_minutes || 60 });
          return [o.id, own || null];
        })
    );
    setFits(Object.fromEntries(fitRows));
  };

  // Asking, not taking: since 0125 the office approves who covers a shift,
  // so this records the ask and the shift stays off the rota until then.
  const accept = async (offer) => {
    const ok = await confirm(
      `Ask for the shift on ${formatWhen(offer.jobs.scheduled_at)} at ${offer.jobs?.properties?.address}? `
      + "The office will confirm who gets it, and it goes on your rota once they've approved you.",
      { title: 'Ask for this shift' }
    );
    if (!ok) return;

    setBusyId(offer.id);
    const { data, error } = await supabase.rpc('claim_shift_offer', { target_offer_id: offer.id });
    setBusyId(null);

    if (error) { toast.error("Couldn't send that — try again."); return; }

    if (data === 'requested') {
      setRequestedIds((prev) => [...prev, offer.id]);
      // Straight to the office's phones, so an early shift is not waiting
      // on somebody happening to have the app open.
      notify({ type: 'shift_cover_requested', offerId: offer.id });
      toast.success("Asked — the office will let you know if it's yours.");
      return;
    }

    if (data !== 'ok') {
      toast.error(CLAIM_MESSAGES[data] || "Couldn't send that.");
      load();
      return;
    }

    // 'ok' is the database before 0125, which still assigns straight away.
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

  const withdrawAsk = async (offer) => {
    setBusyId(offer.id);
    const { data, error } = await supabase.rpc('withdraw_cover_request', { target_offer_id: offer.id });
    setBusyId(null);
    if (error || data !== 'ok') { toast.error("Couldn't withdraw that — the office may already have answered."); load(); return; }
    setRequestedIds((prev) => prev.filter((id) => id !== offer.id));
    toast.success('Withdrawn — the shift is still up for grabs.');
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

  const split = splitOffers(offers, declinedIds, userId);
  const mine = split.mine;
  // Best fit for this cleaner first; the rest keep their newest-first order.
  const available = split.available
    .map((o, index) => ({ offer: o, index, score: fits[o.id]?.score ?? -1 }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
    .map((x) => x.offer);

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
            Ask for any you can do — the office confirms who gets each one.
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
                  {fits[offer.id] && (
                    <div style={{ fontSize: 12, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {isGoodMatch(fits[offer.id]) && (
                        <span className="badge completed" style={{ fontSize: 11 }}>Good match for you</span>
                      )}
                      {!fits[offer.id].eligible && fits[offer.id].ineligible_reason && (
                        <span style={{ color: 'var(--wf-overdue)' }}>You're {fits[offer.id].ineligible_reason}</span>
                      )}
                      {fits[offer.id].eligible && fits[offer.id].reasons
                        .filter((r) => r.points > 0 && r.key !== 'hours')
                        .slice(0, 2)
                        .map((r) => (
                          <span key={r.key} style={{ color: 'var(--muted)' }}>
                            {r.text.replace('their other job', 'your other job').replace('their usual area', 'your usual area')}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              </div>
              {requestedIds.includes(offer.id) ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--wf-teal-ink)', fontWeight: 600 }}>
                    Asked — waiting for the office to confirm
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => withdrawAsk(offer)}
                    disabled={busyId === offer.id}
                    style={{ flexShrink: 0 }}
                    title="Take back your ask - the shift stays up for grabs"
                  >
                    Withdraw
                  </button>
                </div>
              ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => accept(offer)}
                  disabled={busyId === offer.id}
                  style={{ flex: 1 }}
                  title="Ask the office for this shift - it goes on your rota once they approve you"
                >
                  {busyId === offer.id ? 'Just a sec...' : 'Ask for this shift'}
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
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
