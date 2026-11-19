'use client';

import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionAndProfile } from '../../../lib/authGate';
import { canSeeInvoices } from '../../../lib/invoiceAccess';
import { toCSV, downloadCSV } from '../../../lib/csv';
import { INVOICE_COLUMNS, STATUS, formatMoney } from '../../../lib/subcontractorInvoices';
import SubcontractorInvoiceView, { invoicePeriodLabel, shiftsFromPayroll } from '../../components/SubcontractorInvoiceView';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';

// Invoices subcontractors send us (0154). Jess's login only, like client
// Invoices - the database enforces the same rule (is_invoice_owner).
//
// Approve, ask a question (the subcontractor sees the note and can change
// and resend), or mark paid. The office never edits the figures: hours come
// from payroll and the rest is the subcontractor's own invoice.

const TABS = [
  { key: 'todo', label: 'To check', statuses: ['submitted'] },
  { key: 'queried', label: 'Queried', statuses: ['queried'] },
  { key: 'approved', label: 'To pay', statuses: ['approved'] },
  { key: 'paid', label: 'Paid', statuses: ['paid'] },
  { key: 'withdrawn', label: 'Withdrawn', statuses: ['withdrawn'] },
];

export default function SubcontractorInvoicesAdmin() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [tab, setTab] = useState('todo');
  const [openId, setOpenId] = useState(null);
  const [shifts, setShifts] = useState({});
  const [queryText, setQueryText] = useState('');
  const [querying, setQuerying] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const { session, profile } = await getSessionAndProfile();
    if (!session) { router.push('/'); return; }
    if (profile?.role !== 'admin' || !canSeeInvoices(session)) { router.push('/admin'); return; }

    const { data, error } = await supabase.from('subcontractor_invoices').select(INVOICE_COLUMNS)
      .order('submitted_at', { ascending: false }).limit(500);
    if (error) setUnavailable(true);
    setInvoices(data || []);
    const firstOpen = (data || []).some((i) => i.status === 'submitted') ? 'todo'
      : (data || []).some((i) => i.status === 'approved') ? 'approved' : 'todo';
    setTab(firstOpen);
    setLoading(false);
  };

  const counts = useMemo(() => {
    const c = {};
    TABS.forEach((t) => { c[t.key] = invoices.filter((i) => t.statuses.includes(i.status)).length; });
    return c;
  }, [invoices]);

  const visible = invoices.filter((i) => TABS.find((t) => t.key === tab).statuses.includes(i.status));
  const toPayTotal = invoices.filter((i) => i.status === 'approved').reduce((s, i) => s + Number(i.total || 0), 0);

  const toggle = async (invoice) => {
    if (openId === invoice.id) { setOpenId(null); return; }
    setOpenId(invoice.id);
    setQuerying(null);
    if (shifts[invoice.id]) return;
    const [lines, adjustments] = await Promise.all([
      supabase.from('payroll_period_lines').select('minutes, kind, job_date, job_address')
        .eq('period_id', invoice.period_id).eq('cleaner_id', invoice.subcontractor_id).order('job_date'),
      supabase.from('payroll_adjustments').select('minutes, reason, job_address, job_date')
        .eq('included_in_period_id', invoice.period_id).eq('cleaner_id', invoice.subcontractor_id),
    ]);
    setShifts((prev) => ({ ...prev, [invoice.id]: shiftsFromPayroll(lines.data || [], adjustments.data || []) }));
  };

  const setStatus = async (invoice, status, officeNote) => {
    setBusy(true);
    const patch = { status };
    if (officeNote !== undefined) patch.office_note = officeNote;
    const { data, error } = await supabase.from('subcontractor_invoices').update(patch)
      .eq('id', invoice.id).select(INVOICE_COLUMNS).single();
    setBusy(false);
    if (error || !data) { toast.error(error?.message && error.message.length < 160 ? error.message : "Couldn't save that. Try again in a moment."); return false; }
    setInvoices((prev) => prev.map((i) => (i.id === data.id ? data : i)));
    return true;
  };

  const approve = async (invoice) => {
    if (await setStatus(invoice, 'approved')) toast.success(`Approved ${invoice.subcontractor_name}'s invoice.`);
  };

  const markPaid = async (invoice) => {
    const ok = await confirm(
      `Mark ${invoice.subcontractor_name}'s invoice ${invoice.invoice_number} for ${formatMoney(invoice.total)} as paid? They'll be told it's been paid.`,
      { title: 'Mark as paid', confirmLabel: 'Mark paid' },
    );
    if (!ok) return;
    if (await setStatus(invoice, 'paid')) toast.success('Marked as paid.');
  };

  const sendQuery = async (invoice) => {
    const note = queryText.trim();
    if (!note) { toast.error('Write the question for them first.'); return; }
    if (await setStatus(invoice, 'queried', note.slice(0, 2000))) {
      setQuerying(null);
      setQueryText('');
      toast.success(`Sent your question to ${invoice.subcontractor_name}.`);
    }
  };

  const reopen = async (invoice) => {
    if (await setStatus(invoice, 'submitted')) toast.success('Moved back to To check.');
  };

  const exportCsv = () => {
    const columns = [
      { key: 'name', label: 'Subcontractor' },
      { key: 'business', label: 'Business name' },
      { key: 'number', label: 'Invoice number' },
      { key: 'period', label: 'Pay period' },
      { key: 'start', label: 'Period start' },
      { key: 'hours', label: 'Hours' },
      { key: 'rate', label: 'Hourly rate' },
      { key: 'extras', label: 'Extras' },
      { key: 'net', label: 'Net' },
      { key: 'vat', label: 'VAT' },
      { key: 'vatNumber', label: 'VAT number' },
      { key: 'total', label: 'Total' },
      { key: 'status', label: 'Status' },
      { key: 'sent', label: 'Sent' },
      { key: 'paid', label: 'Paid' },
    ];
    const rows = visible.map((i) => ({
      name: i.subcontractor_name,
      business: i.business_name || '',
      number: i.invoice_number,
      period: invoicePeriodLabel(i),
      start: i.period_start,
      hours: (Number(i.minutes) / 60).toFixed(2),
      rate: Number(i.hourly_rate).toFixed(2),
      extras: Number(i.extras_total).toFixed(2),
      net: Number(i.subtotal).toFixed(2),
      vat: Number(i.vat_amount).toFixed(2),
      vatNumber: i.vat_number || '',
      total: Number(i.total).toFixed(2),
      status: STATUS[i.status]?.label || i.status,
      sent: i.submitted_at?.slice(0, 10) || '',
      paid: i.paid_at?.slice(0, 10) || '',
    }));
    downloadCSV(`subcontractor-invoices-${tab}.csv`, toCSV(columns, rows));
  };

  if (loading) return <PageSkeleton className="container" rows={4} />;

  return (
    <div className="container">
      <BackButton />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Subcontractor invoices</h1>
        {visible.length > 0 && (
          <button className="btn-secondary btn-compact" onClick={exportCsv} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Download size={14} /> CSV
          </button>
        )}
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0 14px' }}>
        Subcontractors invoice from their app once a pay period is closed. Their hours come from payroll; the rate, extras and VAT are theirs.
        {toPayTotal > 0 && <> <strong style={{ color: 'var(--text, inherit)' }}>{formatMoney(toPayTotal)}</strong> approved and waiting to be paid.</>}
      </p>

      {unavailable ? (
        <div className="card"><p style={{ margin: 0, fontSize: 14 }}>Run migration 0154 in Supabase to switch this on.</p></div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => { setTab(t.key); setOpenId(null); }}
                className={tab === t.key ? 'btn-primary btn-compact' : 'btn-secondary btn-compact'}>
                {t.label}{counts[t.key] ? ` (${counts[t.key]})` : ''}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyState title="Nothing here" body={tab === 'todo' ? 'No invoices waiting to be checked.' : 'No invoices in this list.'} />
          ) : visible.map((invoice) => (
            <div key={invoice.id} className="card">
              {openId !== invoice.id ? (
                <button type="button" onClick={() => toggle(invoice)}
                  style={{ all: 'unset', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', alignItems: 'center' }}>
                  <span>
                    <span style={{ fontWeight: 700 }}>{invoice.subcontractor_name || 'Subcontractor'}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 13, display: 'block' }}>
                      {invoice.invoice_number} · {invoicePeriodLabel(invoice)}{invoice.attachment_path ? ' · file attached' : ''}
                    </span>
                  </span>
                  <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{formatMoney(invoice.total)}</span>
                </button>
              ) : (
                <>
                  <SubcontractorInvoiceView invoice={invoice} shifts={shifts[invoice.id]} showWho />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                    {invoice.status === 'submitted' && (
                      <>
                        <button className="btn-primary btn-compact" disabled={busy} onClick={() => approve(invoice)}>Approve</button>
                        <button className="btn-secondary btn-compact" disabled={busy} onClick={() => { setQuerying(invoice.id); setQueryText(''); }}>Ask a question</button>
                      </>
                    )}
                    {invoice.status === 'approved' && (
                      <>
                        <button className="btn-primary btn-compact" disabled={busy} onClick={() => markPaid(invoice)}>Mark paid</button>
                        <button className="btn-secondary btn-compact" disabled={busy} onClick={() => { setQuerying(invoice.id); setQueryText(''); }}>Ask a question</button>
                      </>
                    )}
                    {invoice.status === 'queried' && (
                      <button className="btn-secondary btn-compact" disabled={busy} onClick={() => reopen(invoice)}>Move back to To check</button>
                    )}
                    <button className="btn-secondary btn-compact" onClick={() => setOpenId(null)}>Close</button>
                  </div>
                  {querying === invoice.id && (
                    <div style={{ marginTop: 10 }}>
                      <label htmlFor={`q-${invoice.id}`}>Your question - {invoice.subcontractor_name} sees this and can change and resend the invoice</label>
                      <textarea id={`q-${invoice.id}`} rows={3} value={queryText} onChange={(e) => setQueryText(e.target.value)} maxLength={2000}
                        placeholder="e.g. Can you check the rate? We agreed £14/hr." />
                      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <button className="btn-primary btn-compact" disabled={busy} onClick={() => sendQuery(invoice)}>Send question</button>
                        <button className="btn-secondary btn-compact" onClick={() => setQuerying(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
