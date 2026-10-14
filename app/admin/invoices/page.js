'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, AlertTriangle, Download } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionAndProfile } from '../../../lib/authGate';
import { monthBounds, monthLabel, recentMonths } from '../../../lib/detailedReport';
import {
  buildInvoiceBreakdown, breakdownText, formatHours, gbp, propertyLineText, refreshLineText,
  quickbooksRows, QUICKBOOKS_COLUMNS,
} from '../../../lib/invoiceBreakdown';
import { toCSV, downloadCSV } from '../../../lib/csv';
import { localDateString } from '../../../lib/localDate';
import { useToast } from '../../components/ToastProvider';
import BackButton from '../../components/BackButton';

// A client's month of visits laid out for their QuickBooks invoice: one line
// per property with the visit dates, room refreshes on their own lines, each
// at the client's hourly rate. Built for TKR Management (October 2026).
export default function InvoiceBreakdown() {
  const router = useRouter();
  const toast = useToast();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  // Invoices go out after the month ends, so last month is the usual one.
  const [month, setMonth] = useState(recentMonths(2)[1]);
  const [rateInput, setRateInput] = useState('');
  const [breakdown, setBreakdown] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [error, setError] = useState('');
  // For the QuickBooks import file.
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(localDateString(new Date()));
  const [product, setProduct] = useState('Cleaning');

  useEffect(() => {
    (async () => {
      const { session, profile } = await getSessionAndProfile();
      if (!session) { router.push('/'); return; }
      // Charges are admin-only, like payroll.
      if (profile?.role !== 'admin') { router.push('/admin'); return; }

      const { data, error: clientsError } = await supabase.from('clients').select('id, name, hourly_rate').order('name');
      if (clientsError) { setError('Couldn\'t load the clients.'); setLoading(false); return; }
      const sorted = [...(data || [])].sort((a, b) => Number(b.hourly_rate != null) - Number(a.hourly_rate != null));
      setClients(sorted);
      setClientId(sorted[0]?.id || '');
      setLoading(false);
    })();
  }, []);

  const client = clients.find((c) => c.id === clientId);
  const rate = client?.hourly_rate != null ? Number(client.hourly_rate) : null;

  useEffect(() => {
    setRateInput(rate != null ? String(rate) : '');
  }, [clientId, rate]);

  useEffect(() => {
    if (!clientId) return;
    (async () => {
      setLoadingMonth(true);
      setError('');
      const bounds = monthBounds(month);
      const { data: properties, error: propError } = await supabase
        .from('properties').select('id, address').eq('client_id', clientId);
      const ids = (properties || []).map((p) => p.id);
      const { data: jobs, error: jobsError } = ids.length === 0
        ? { data: [] }
        : await supabase
          .from('jobs')
          .select('id, property_id, scheduled_at, status, duration_minutes, room_refreshes, hours_review_needed, job_assignments(cleaner_id)')
          .in('property_id', ids)
          .gte('scheduled_at', bounds.start)
          .lt('scheduled_at', bounds.end);
      setLoadingMonth(false);
      if (propError || jobsError) { setError('Couldn\'t load that month\'s visits.'); setBreakdown(null); return; }
      setBreakdown(buildInvoiceBreakdown({ properties, jobs, rate: rate || 0 }));
    })();
  }, [clientId, month, rate]);

  const saveRate = async () => {
    const value = rateInput.trim() === '' ? null : Number(rateInput);
    if (value != null && !(value >= 0)) { toast.error('Enter the rate as a number, e.g. 24'); return; }
    const { error: saveError } = await supabase.from('clients').update({ hourly_rate: value }).eq('id', clientId);
    if (saveError) { toast.error('Couldn\'t save the rate.'); return; }
    setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, hourly_rate: value } : c)));
    toast.success('Hourly rate saved.');
  };

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied.`);
    } catch {
      toast.error('Couldn\'t copy - select the text and copy it instead.');
    }
  };

  const downloadForQuickBooks = () => {
    if (!invoiceNo.trim()) { toast.error('Enter the invoice number first - the next one in QuickBooks.'); return; }
    if (!product.trim()) { toast.error('Enter the product or service name from QuickBooks.'); return; }
    const rows = quickbooksRows(breakdown, {
      invoiceNo: invoiceNo.trim(), customer: client.name, invoiceDate, item: product.trim(), rate: rate || 0,
      memo: `HMO Cleaning - ${monthLabel(month)}`,
    });
    downloadCSV(`${client.name} ${month} invoice ${invoiceNo.trim()}.csv`, toCSV(QUICKBOOKS_COLUMNS, rows));
  };

  if (loading) return <div className="page-inner">Loading...</div>;

  const monthName = monthLabel(month);
  const empty = breakdown && breakdown.lines.length === 0 && breakdown.refreshes.length === 0;

  return (
    <div className="page-inner">
      <BackButton />
      <div className="page-header-row">
        <div>
          <h1>Invoice breakdown</h1>
          <p className="page-subtitle">A month of visits for a client&apos;s QuickBooks invoice: each property with its dates, and room refreshes on their own lines</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field-row">
          <div className="field">
            <label className="field-label">Client</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ marginBottom: 0 }}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Month</label>
            <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ marginBottom: 0 }}>
              {recentMonths(12).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Hourly rate (£)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="number" min="0" step="0.01" value={rateInput} onChange={(e) => setRateInput(e.target.value)} placeholder="e.g. 24" style={{ marginBottom: 0 }} />
              {rateInput !== (rate != null ? String(rate) : '') && (
                <button type="button" className="btn-secondary" onClick={saveRate}>Save</button>
              )}
            </div>
          </div>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0 0' }}>
          Charged on each visit&apos;s booked length. Only visits that happened are included - missed visits and ones not closed on the rota are left out.
          Add room refreshes on the rota by opening the visit.
        </p>
      </div>

      {error && <div className="card" style={{ color: 'var(--wf-overdue)' }}>{error}</div>}
      {loadingMonth && <div className="card">Loading {monthName}...</div>}

      {!loadingMonth && breakdown && (
        <>
          {rate == null && (
            <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} style={{ flexShrink: 0 }} />
              <span>{client?.name} has no hourly rate yet, so the charges show as £0. Enter it above and press Save.</span>
            </div>
          )}

          {breakdown.warnings.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, marginBottom: 6 }}>
                <AlertTriangle size={18} /> Check before invoicing
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
                {breakdown.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {empty ? (
            <div className="card">No visits to invoice for {client?.name} in {monthName}.</div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <h2 style={{ margin: 0 }}>HMO Cleaning - {monthName}</h2>
                  <button type="button" className="btn-primary" onClick={() => copy(breakdownText(breakdown, monthName, rate || 0), 'The whole breakdown')}>
                    <Copy size={16} /> Copy the whole breakdown
                  </button>
                </div>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 12px' }}>
                  In QuickBooks, add one line per row: paste the description, then put the hours as the quantity and {rate != null ? gbp(rate) : 'the hourly rate'} as the rate.
                </p>

                <InvoiceTable
                  rows={breakdown.lines.map((l) => ({ key: l.id, text: propertyLineText(l), minutes: l.minutes, amount: l.amount }))}
                  onCopy={(text) => copy(text, 'Line')}
                />
                <TotalRow label="Cleaning" amount={breakdown.cleaningTotal} />
              </div>

              {breakdown.refreshes.length > 0 && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <h2 style={{ margin: '0 0 12px' }}>Room Refreshes</h2>
                  <InvoiceTable
                    rows={breakdown.refreshes.map((r, i) => ({ key: `${r.jobId}-${i}`, text: refreshLineText(r), minutes: r.minutes, amount: r.amount }))}
                    onCopy={(text) => copy(text, 'Line')}
                  />
                  <TotalRow label="Room refreshes" amount={breakdown.refreshTotal} />
                </div>
              )}

              <div className="card">
                <TotalRow label={`Total for ${monthName}`} amount={breakdown.total} strong />
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: '6px 0 0' }}>
                  QuickBooks adds your business details and payment details.
                </p>
              </div>

              <div className="card" style={{ marginTop: 16 }}>
                <h2 style={{ margin: '0 0 4px' }}>Put it into QuickBooks</h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 12px' }}>
                  Download the file, then in QuickBooks go to Settings (the cog), Import data, Invoices, and upload it. It makes one invoice
                  to {client?.name}, due on receipt, with every line above.
                </p>
                <div className="field-row">
                  <div className="field">
                    <label className="field-label">Invoice number</label>
                    <input type="text" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="The next one in QuickBooks" style={{ marginBottom: 0 }} />
                  </div>
                  <div className="field">
                    <label className="field-label">Invoice date</label>
                    <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value || localDateString(new Date()))} style={{ marginBottom: 0 }} />
                  </div>
                  <div className="field">
                    <label className="field-label">Product/service in QuickBooks</label>
                    <input type="text" value={product} onChange={(e) => setProduct(e.target.value)} style={{ marginBottom: 0 }} />
                  </div>
                </div>
                <button type="button" className="btn-primary" onClick={downloadForQuickBooks} style={{ marginTop: 12 }}>
                  <Download size={16} /> Download for QuickBooks
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// Same table look as Payroll.
const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid var(--hairline)', whiteSpace: 'nowrap', color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.03em' };
const td = { padding: '9px 12px', borderBottom: '1px solid var(--hairline)', verticalAlign: 'top' };
const num = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontFamily: 'var(--wf-data)', fontWeight: 600 };

function InvoiceTable({ rows, onCopy }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
        <thead>
          <tr>
            <th style={th}>Description</th>
            <th style={{ ...th, textAlign: 'right' }}>Hours</th>
            <th style={{ ...th, textAlign: 'right' }}>Amount</th>
            <th style={th} aria-label="Copy" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={td}>{r.text}</td>
              <td style={num}>{formatHours(r.minutes)}</td>
              <td style={num}>{gbp(r.amount)}</td>
              <td style={{ ...td, textAlign: 'right' }}>
                <button type="button" className="btn-secondary" onClick={() => onCopy(r.text)} title="Copy this description for QuickBooks" aria-label="Copy description">
                  <Copy size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TotalRow({ label, amount, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontWeight: strong ? 700 : 600, fontSize: strong ? 18 : 15 }}>
      <span>{label}</span>
      <span>{gbp(amount)}</span>
    </div>
  );
}
