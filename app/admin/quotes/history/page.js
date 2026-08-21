'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../../lib/authGate';
import { formatPriceGBP, quoteReference, quoteRecipientName } from '../../../../lib/companyBranding';
import { ROOM_TYPES, ADDON_TYPES, OVEN_OPTIONS } from '../../../../lib/quoteCalculator';
import { summariseShiftSchedule } from '../../../../lib/shiftSchedule';
import BackButton from '../../../components/BackButton';

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', accepted: 'Accepted', declined: 'Declined', expired: 'Expired' };
const STATUS_BADGE_CLASS = { draft: 'scheduled', sent: 'in_progress', accepted: 'completed', declined: 'missed', expired: 'missed' };

export default function QuoteHistory() {
  const router = useRouter();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedQuote, setSelectedQuote] = useState(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }

    const { data } = await supabase
      .from('quotes')
      .select('id, client_id, prospect_name, prospect_email, prospect_phone, description, price, status, valid_until, notes, created_at, calculator_input, calculator_breakdown, shift_schedule, clients(name)')
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
      <BackButton />
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
                <tr
                  key={quote.id}
                  style={{ borderBottom: '1px solid var(--hairline)', cursor: 'pointer' }}
                  onClick={() => setSelectedQuote(quote)}
                >
                  <td style={{ padding: '8px 6px', fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{quoteReference(quote)}</td>
                  <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{new Date(quote.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '8px 6px' }}>
                    {quote.client_id ? (
                      <Link href={`/admin/clients/${quote.client_id}`} style={{ color: 'inherit' }} onClick={(e) => e.stopPropagation()}>{recipient}</Link>
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

      {selectedQuote && (
        <div className="job-modal-overlay" onClick={() => setSelectedQuote(null)}>
          <div className="card job-modal" onClick={(e) => e.stopPropagation()}>
            <div className="page-header-row" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{quoteRecipientName(selectedQuote)}</h2>
              <button className="btn-secondary" onClick={() => setSelectedQuote(null)}>Close</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span className={`badge ${STATUS_BADGE_CLASS[selectedQuote.status]}`}>{STATUS_LABELS[selectedQuote.status]}</span>
              <strong style={{ fontSize: 20 }}>{formatPriceGBP(selectedQuote.price)}</strong>
            </div>

            <p style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 10 }}>
              {quoteReference(selectedQuote)} · Quoted {new Date(selectedQuote.created_at).toLocaleDateString()}
              {selectedQuote.valid_until && ` · Valid until ${new Date(selectedQuote.valid_until).toLocaleDateString()}`}
            </p>

            {(selectedQuote.prospect_email || selectedQuote.prospect_phone) && (
              <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
                {[selectedQuote.prospect_email, selectedQuote.prospect_phone].filter(Boolean).join(' · ')}
              </p>
            )}

            <div style={{ marginTop: 12 }}>
              <label>Description</label>
              <p style={{ fontSize: 14, margin: '4px 0 0' }}>{selectedQuote.description}</p>
            </div>

            {selectedQuote.notes && (
              <div style={{ marginTop: 12 }}>
                <label>Internal notes</label>
                <p style={{ fontSize: 14, margin: '4px 0 0', fontStyle: 'italic' }}>{selectedQuote.notes}</p>
              </div>
            )}

            {(() => {
              const sched = summariseShiftSchedule(selectedQuote.shift_schedule);
              if (!sched) return null;
              return (
                <div style={{ marginTop: 16 }}>
                  <label>Shift Pattern (read only)</label>
                  <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.9, marginTop: 4 }}>
                    {sched.patterns.map((p, i) => (
                      <div key={i}>
                        {p.label || 'Shift'}: {p.timeRange}
                        {p.occasional
                          ? ` — ${p.hoursPerOccasion}h per ${p.occasionLabel || 'occurrence'} at ${formatPriceGBP(p.rate)}/hr = ${formatPriceGBP(p.chargePerOccasion)}`
                          : ` — ${p.daysDescription} — ${p.hoursPerWeek}h/week at ${formatPriceGBP(p.rate)}/hr = ${formatPriceGBP(p.weeklyCharge)}/week`}
                      </div>
                    ))}
                    <div style={{ fontWeight: 600, color: 'var(--ink)', marginTop: 4 }}>
                      {sched.weeklyHours}h per week — {formatPriceGBP(sched.weeklyCharge)}/week
                      {sched.contractValues.map((c) => ` · ${c.weeks}wk ${formatPriceGBP(c.value)}`).join('')}
                    </div>
                  </div>
                </div>
              );
            })()}

            {selectedQuote.calculator_input && selectedQuote.calculator_breakdown ? (
              <>
                <div style={{ marginTop: 16 }}>
                  <label>Calculator Inputs (read only)</label>
                  <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.9, marginTop: 4 }}>
                    <div>Property type: {selectedQuote.calculator_input.propertyType}</div>
                    <div>Condition: {selectedQuote.calculator_input.condition}</div>
                    <div>Clean type: {selectedQuote.calculator_input.cleanType}</div>
                    <div>Furnished: {selectedQuote.calculator_input.furnished}</div>
                    {Number(selectedQuote.calculator_input.travelMiles) > 0 && (
                      <div>Travel: {selectedQuote.calculator_input.travelMiles} miles</div>
                    )}
                    <div>
                      Rooms: {ROOM_TYPES
                        .filter((r) => Number(selectedQuote.calculator_input.rooms?.[r.key]) > 0)
                        .map((r) => `${selectedQuote.calculator_input.rooms[r.key]} ${r.label}`)
                        .join(', ') || 'None'}
                    </div>
                    <div>
                      Extras: {ADDON_TYPES
                        .filter((a) => selectedQuote.calculator_input.addons?.[a.key])
                        .map((a) => a.label)
                        .join(', ') || 'None'}
                    </div>
                    <div>
                      Oven clean: {selectedQuote.calculator_input.oven && selectedQuote.calculator_input.oven !== 'none'
                        ? OVEN_OPTIONS[selectedQuote.calculator_input.oven]?.label
                        : 'None'}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 16, background: '#f8fafc', borderRadius: 10, padding: 12 }}>
                  <label>Price Breakdown</label>
                  <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.9, marginTop: 4 }}>
                    <div>
                      {selectedQuote.calculator_breakdown.totalHours}h estimated · {selectedQuote.calculator_breakdown.chargeableHours}h chargeable
                      {' · '}{formatPriceGBP(selectedQuote.calculator_breakdown.hourlyEquivalent)}/hr equivalent · {selectedQuote.calculator_breakdown.pricePosition}
                    </div>
                    <div>
                      Cleaner wage {formatPriceGBP(selectedQuote.calculator_breakdown.cleanerWageCost)}
                      {' · '}Holiday {formatPriceGBP(selectedQuote.calculator_breakdown.holidayCost)}
                      {' · '}NI {formatPriceGBP(selectedQuote.calculator_breakdown.niCost)}
                      {' · '}Pension {formatPriceGBP(selectedQuote.calculator_breakdown.pensionCost)}
                    </div>
                    <div>
                      Materials {formatPriceGBP(selectedQuote.calculator_breakdown.materialsCost)}
                      {' · '}Admin {formatPriceGBP(selectedQuote.calculator_breakdown.adminCost)}
                      {' · '}Travel {formatPriceGBP(selectedQuote.calculator_breakdown.travelCost)}
                    </div>
                    {selectedQuote.calculator_breakdown.ovenCharge > 0 && (
                      <div>
                        Oven charge {formatPriceGBP(selectedQuote.calculator_breakdown.ovenCharge)}
                        {' '}(cleaner pay {formatPriceGBP(selectedQuote.calculator_breakdown.ovenCleanerPay)})
                      </div>
                    )}
                    <div style={{ fontWeight: 600, color: 'var(--ink)', marginTop: 4 }}>
                      Profit {formatPriceGBP(selectedQuote.calculator_breakdown.profit)} ({(selectedQuote.calculator_breakdown.marginPct * 100).toFixed(1)}%) — {selectedQuote.calculator_breakdown.marginWarning}
                    </div>
                  </div>
                </div>
              </>
            ) : selectedQuote.shift_schedule ? null : (
              <p className="empty-state" style={{ marginTop: 16 }}>This quote was entered manually — no calculator breakdown available.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
