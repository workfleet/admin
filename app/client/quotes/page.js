'use client';

import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import BackButton from '../../components/BackButton';
import { useConfirm } from '../../components/ConfirmProvider';
import { pricePeriodSuffix } from '../../../lib/quoteCalculator';

// Quotes we've sent this client, to accept or decline. Read through
// client_quotes() (0148), which returns only the client-facing fields -
// a quote row also holds our costs and margin.


const money = (n) => `£${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateOnly = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export default function ClientQuotes() {
  const router = useRouter();
  const confirm = useConfirm();
  const [quotes, setQuotes] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const { data, error } = await supabase.rpc('client_quotes');
    setQuotes(error ? [] : data || []);
  };

  useEffect(() => {
    (async () => {
      const session = await getSessionWithRetry();
      if (!session) { router.push('/'); return; }
      load();
    })();
  }, []);

  const respond = async (q, accept) => {
    const ok = await confirm(
      accept
        ? `Accept this quote for ${money(q.price)}${pricePeriodSuffix(q.price_period)}? We'll be in touch to book it in.`
        : 'Decline this quote? You can still message us if you\'d like it changed.',
      { title: accept ? 'Accept quote' : 'Decline quote', danger: !accept },
    );
    if (!ok) return;
    setBusyId(q.id);
    setMessage('');
    const { data, error } = await supabase.rpc('respond_to_quote', { p_quote_id: q.id, p_accept: accept });
    setBusyId(null);
    if (error) { setMessage("That didn't go through - please try again."); return; }
    if (data === 'expired') setMessage('This quote has run out - message us and we\'ll send a fresh one.');
    else if (data === 'already_decided') setMessage('This quote has already been answered.');
    else if (data === 'accepted') setMessage("Thanks - you've accepted the quote. We'll be in touch to book it in.");
    else if (data === 'declined') setMessage("You've declined the quote. Message us if you'd like it changed.");
    load();
  };

  const download = async (q) => {
    setBusyId(q.id);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/quotes/${q.id}/pdf`, { headers: { Authorization: `Bearer ${session?.access_token || ''}` } });
    setBusyId(null);
    if (!res.ok) { setMessage("Couldn't open the PDF - please try again."); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `quote-${q.id.slice(0, 8)}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  if (quotes === null) return <PageSkeleton className="" rows={3} />;

  const today = new Date().toISOString().slice(0, 10);
  const waiting = quotes.filter((q) => q.status === 'sent');
  const answered = quotes.filter((q) => q.status !== 'sent');

  const card = (q) => {
    const expired = q.status === 'sent' && q.valid_until && q.valid_until < today;
    return (
      <div key={q.id} className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {money(q.price)}<span style={{ fontSize: 14, fontWeight: 500, color: 'var(--muted)' }}>{pricePeriodSuffix(q.price_period)}</span>
          </div>
          <span className={`badge ${q.status === 'accepted' ? 'completed' : q.status === 'declined' || expired ? 'missed' : 'scheduled'}`} style={{ flexShrink: 0 }}>
            {expired ? 'expired' : q.status === 'sent' ? 'waiting for you' : q.status}
          </span>
        </div>
        <p style={{ fontSize: 14, margin: '8px 0', whiteSpace: 'pre-wrap' }}>{q.description}</p>
        <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 12px' }}>
          Sent {dateOnly(q.created_at)}
          {q.valid_until && q.status === 'sent' ? ` · valid until ${dateOnly(q.valid_until)}` : ''}
          {q.decided_at && q.status !== 'sent' ? ` · ${q.status} ${dateOnly(q.decided_at)}` : ''}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {q.status === 'sent' && !expired && (
            <>
              <button type="button" onClick={() => respond(q, true)} disabled={busyId === q.id}>Accept</button>
              <button type="button" className="btn-secondary" onClick={() => respond(q, false)} disabled={busyId === q.id}>Decline</button>
            </>
          )}
          <button type="button" className="btn-secondary" onClick={() => download(q)} disabled={busyId === q.id}>
            <Download size={15} style={{ marginRight: 6, verticalAlign: '-3px' }} /> PDF
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Quotes</h1>
          <p className="page-subtitle">Prices we&rsquo;ve sent you, to accept or decline</p>
        </div>
      </div>

      {message && <div className="card" style={{ marginBottom: 12, fontSize: 14 }}>{message}</div>}

      {quotes.length === 0 && (
        <p className="empty-state">No quotes yet. Ask for extra work from your dashboard and we&rsquo;ll price it for you here.</p>
      )}

      {waiting.length > 0 && <h2 style={{ margin: '8px 0 10px' }}>Waiting for you</h2>}
      {waiting.map(card)}

      {answered.length > 0 && <h2 style={{ margin: '16px 0 10px' }}>Earlier quotes</h2>}
      {answered.map(card)}
    </div>
  );
}
