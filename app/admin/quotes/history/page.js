'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import { formatPriceGBP, quoteReference } from '../../../../lib/companyBranding';

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' };
const STATUS_BADGE_CLASS = { draft: 'scheduled', sent: 'in_progress', accepted: 'completed', declined: 'missed', expired: 'missed' };

export default function QuoteHistory() {
  const router = useRouter();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('quotes')
      .select('id, client_id, prospect_name, description, price, status, valid_until, created_at, calculator_breakdown, clients(name)')
      .order('created_at', { ascending: false });

    setQuotes(data || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((quote) => {
      if (statusFilter !== 'all' && quote.status !== statusFilter) return false;
      if (!q) return true;
      const recipient = quote.client_id ? quote.clients?.name : quote.prospect_name;
      return [recipient, quote.description].some((v) => v?.toLowerCase().includes(q));
    });
  }, [quotes, search, statusFilter]);

  if (loading) return <div className="page-inner">Loading...</div>;

  return (
    <div className="page-inner">
      <Link href="/admin/quotes" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: 'var(--muted)', textDecoration: 'none', marginBottom: 12 }}>
        <ArrowLeft size={15} /> Back to Quotes
      </Link>

      <div className="page-header-row">
        <div>
          <h1>Quote History</h1>
          <p className="page-subtitle">{quotes.length} quote{quotes.length === 1 ? '' : 's'} logged, oldest to newest</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client, prospect, or description..."
          style={{ flex: 1, minWidth: 220, marginBottom: 0 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 'auto', margin: 0 }}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 && <p className="empty-state">No quotes match.</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid var(--hairline)' }}>
              <th style={{ padding: '8px 6px' }}>Ref</th>
              <th style={{ padding: '8px 6px' }}>Date</th>
              <th style={{ padding: '8px 6px' }}>For</th>
              <th style={{ padding: '8px 6px' }}>Description</th>
              <th style={{ padding: '8px 6px' }}>Hours</th>
              <th style={{ padding: '8px 6px' }}>Margin</th>
              <th style={{ padding: '8px 6px', textAlign: 'right' }}>Price</th>
              <th style={{ padding: '8px 6px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((quote) => {
              const recipient = quote.client_id ? (quote.clients?.name || 'Unknown client') : quote.prospect_name;
              const b = quote.calculator_breakdown;
              return (
                <tr key={quote.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{quoteReference(quote)}</td>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{new Date(quote.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '8px 6px' }}>
                    {quote.client_id ? (
                      <Link href={`/admin/clients/${quote.client_id}`} style={{ color: 'inherit' }}>{recipient}</Link>
                    ) : recipient}
                  </td>
                  <td style={{ padding: '8px 6px', color: 'var(--muted)', maxWidth: 320 }}>{quote.description}</td>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{b ? `${b.totalHours}h` : '—'}</td>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{b ? `${(b.marginPct * 100).toFixed(1)}%` : '—'}</td>
                  <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatPriceGBP(quote.price)}</td>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                    <span className={`badge ${STATUS_BADGE_CLASS[quote.status]}`}>{STATUS_LABELS[quote.status]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
