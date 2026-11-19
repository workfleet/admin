'use client';

import { PageSkeleton } from '../../components/Skeleton';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Paperclip, X } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import { getSessionWithRetry } from '../../../lib/authGate';
import { fetchEmploymentTypes, isSubcontractor } from '../../../lib/profilePrivate';
import { formatHours } from '../../../lib/hoursWorked';
import { fetchAllRows } from '../../../lib/fetchAllRows';
import { periodLabel, monthLabelIfWhole } from '../../../lib/payroll';
import {
  INVOICE_COLUMNS, ATTACHMENT_BUCKET, MAX_ATTACHMENT_BYTES, MAX_EXTRAS,
  attachmentPath, canEdit, computeTotals, emptyExtra, extrasFromForm, formFromInvoice,
  formatMoney, invoiceablePeriods, newForm, parseMoney, rowFromForm,
} from '../../../lib/subcontractorInvoices';
import SubcontractorInvoiceView, { shiftsFromPayroll } from '../../components/SubcontractorInvoiceView';
import BackButton from '../../components/BackButton';
import { useConfirm } from '../../components/ConfirmProvider';
import { useToast } from '../../components/ToastProvider';

// A subcontractor's invoices to us (0154). They pick a closed pay period, the
// hours come from payroll, they type their rate and any extras, and can
// attach their own invoice file too. The office (Jess) approves, queries or
// marks it paid on /admin/subcontractor-invoices.

const periodName = (p) => monthLabelIfWhole(p) || periodLabel(p);

export default function SubcontractorInvoices() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [invoices, setInvoices] = useState([]);
  const [payrollLines, setPayrollLines] = useState([]);
  const [payrollAdjustments, setPayrollAdjustments] = useState([]);
  // null: not editing. 'new': a new invoice. Otherwise the id being changed.
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(newForm(null));
  const [file, setFile] = useState(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const session = await getSessionWithRetry();
    if (!session) { router.push('/'); return; }
    setUserId(session.user.id);

    const employmentTypes = await fetchEmploymentTypes();
    if (!isSubcontractor(employmentTypes[session.user.id])) {
      setAllowed(false);
      setLoading(false);
      return;
    }
    setAllowed(true);

    const [inv, lines, adjustments] = await Promise.all([
      supabase.from('subcontractor_invoices').select(INVOICE_COLUMNS)
        .eq('subcontractor_id', session.user.id).order('period_start', { ascending: false }),
      // A long-serving subcontractor can pass 1000 lines.
      fetchAllRows(() => supabase.from('payroll_period_lines')
        .select('id, minutes, kind, job_date, job_address, period_id, payroll_periods(id, period_start, period_end)')
        .eq('cleaner_id', session.user.id)
        .order('id')),
      supabase.from('payroll_adjustments')
        .select('minutes, reason, job_address, job_date, included_in_period_id, period:payroll_periods!payroll_adjustments_included_in_period_id_fkey(id, period_start, period_end)')
        .eq('cleaner_id', session.user.id)
        .not('included_in_period_id', 'is', null),
    ]);
    if (inv.error) setUnavailable(true);
    setInvoices(inv.data || []);
    setPayrollLines(lines.data || []);
    setPayrollAdjustments(adjustments.data || []);
    setLoading(false);
  };

  const shiftsFor = (periodId) => shiftsFromPayroll(
    payrollLines.filter((l) => l.period_id === periodId),
    payrollAdjustments.filter((a) => a.included_in_period_id === periodId),
  );

  const open = useMemo(() => invoiceablePeriods(payrollLines, payrollAdjustments, invoices), [payrollLines, payrollAdjustments, invoices]);

  // The period list in the form: open ones, plus the one being edited.
  const editingInvoice = editing && editing !== 'new' ? invoices.find((i) => i.id === editing) : null;
  const choosable = editingInvoice
    ? [{ id: editingInvoice.period_id, start: editingInvoice.period_start, end: editingInvoice.period_end, minutes: shiftsFor(editingInvoice.period_id).reduce((s, x) => s + x.minutes, 0) }]
    : open;
  const chosen = choosable.find((p) => p.id === form.periodId);
  const minutes = chosen?.minutes || 0;

  const preview = useMemo(() => {
    const { extras } = extrasFromForm(form.extras);
    return computeTotals({
      minutes,
      hourlyRate: parseMoney(form.hourlyRate) || 0,
      extras: extras || [],
      vatRate: form.chargeVat ? 20 : 0,
    });
  }, [form, minutes]);

  const change = (patch) => { setForm((f) => ({ ...f, ...patch })); setError(''); };
  const changeExtra = (index, patch) => change({ extras: form.extras.map((e, i) => (i === index ? { ...e, ...patch } : e)) });

  const startNew = () => {
    const last = invoices.find((i) => i.status !== 'withdrawn') || invoices[0] || null;
    const f = newForm(last);
    f.periodId = open[0]?.id || '';
    setForm(f);
    setFile(null);
    setRemoveAttachment(false);
    setError('');
    setEditing('new');
  };

  const startEdit = (invoice) => {
    setForm(formFromInvoice(invoice));
    setFile(null);
    setRemoveAttachment(false);
    setError('');
    setEditing(invoice.id);
  };

  const cancel = () => { setEditing(null); setError(''); };

  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > MAX_ATTACHMENT_BYTES) { setError('That file is over 10 MB - try a smaller copy or a photo.'); return; }
    setFile(f);
    setRemoveAttachment(false);
    setError('');
  };

  const save = async (e) => {
    e.preventDefault();
    const { row, error: problem } = rowFromForm(form, { minutes });
    if (problem) { setError(problem); return; }
    setSaving(true);

    let uploadedPath = null;
    if (file) {
      uploadedPath = attachmentPath(userId, file.name);
      const { error: upErr } = await supabase.storage.from(ATTACHMENT_BUCKET).upload(uploadedPath, file, { contentType: file.type || undefined });
      if (upErr) {
        setSaving(false);
        setError(/fetch|network/i.test(upErr.message || '')
          ? "Couldn't upload the file - there's no signal. Try again when you're back in range."
          : "Couldn't upload the file. Try again, or send it without the file.");
        return;
      }
    }

    const oldPath = editingInvoice?.attachment_path || null;
    const attachment = uploadedPath
      ? { attachment_path: uploadedPath, attachment_name: file.name.slice(0, 120) }
      : removeAttachment ? { attachment_path: null, attachment_name: null } : {};

    const query = editing === 'new'
      ? supabase.from('subcontractor_invoices').insert({ ...row, ...attachment, subcontractor_id: userId })
      : supabase.from('subcontractor_invoices').update({ ...row, ...attachment, status: 'submitted' }).eq('id', editing);
    const { data, error: saveErr } = await query.select(INVOICE_COLUMNS).single();
    setSaving(false);

    if (saveErr || !data) {
      if (uploadedPath) supabase.storage.from(ATTACHMENT_BUCKET).remove([uploadedPath]);
      const msg = saveErr?.message || '';
      setError(
        /fetch|network/i.test(msg) ? "Couldn't send it - there's no signal. Everything you typed is still here; try again when you're back in range."
          : saveErr?.code === '23505' ? 'You have already sent an invoice for that pay period.'
            : /relation .* does not exist|42P01/.test(msg) || saveErr?.code === '42P01' ? "Invoices aren't switched on yet - ask the office."
              : msg.length < 160 && msg ? msg : "Couldn't send it. Try again in a moment, or ring the office."
      );
      return;
    }

    if (oldPath && (uploadedPath || removeAttachment) && oldPath !== data.attachment_path) {
      supabase.storage.from(ATTACHMENT_BUCKET).remove([oldPath]);
    }
    setInvoices((prev) => [data, ...prev.filter((i) => i.id !== data.id)]
      .sort((a, b) => String(b.period_start).localeCompare(String(a.period_start))));
    setEditing(null);
    toast.success(editing === 'new' ? 'Invoice sent to the office.' : 'Invoice sent again.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const withdraw = async (invoice) => {
    const ok = await confirm(
      `Withdraw invoice ${invoice.invoice_number}? The office will no longer pay it, and you can send a new one for the same pay period.`,
      { title: 'Withdraw invoice', confirmLabel: 'Withdraw', danger: true },
    );
    if (!ok) return;
    const { data, error: err } = await supabase.from('subcontractor_invoices')
      .update({ status: 'withdrawn' }).eq('id', invoice.id).select(INVOICE_COLUMNS).single();
    if (err || !data) { toast.error("Couldn't withdraw it. Try again in a moment."); return; }
    setInvoices((prev) => prev.map((i) => (i.id === data.id ? data : i)));
    toast.success('Invoice withdrawn.');
  };

  if (loading) return <PageSkeleton className="container" rows={3} />;

  if (!allowed) {
    return (
      <div className="container">
        <BackButton />
        <h1 style={{ marginTop: 0 }}>Invoices</h1>
        <div className="card"><p style={{ margin: 0, fontSize: 14 }}>Invoicing is for subcontractors. Your pay is worked out from your hours - see My hours.</p></div>
      </div>
    );
  }

  const currentAttachmentName = file?.name || (!removeAttachment && editingInvoice?.attachment_name) || null;

  return (
    <div className="container">
      <BackButton />
      <h1 style={{ marginTop: 0 }}>Invoices</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: -4 }}>
        Invoice us for a pay period once the office has closed it. Your hours come straight from payroll, so they always match.
      </p>

      {unavailable && (
        <div className="card"><p style={{ margin: 0, fontSize: 14 }}>This isn't ready yet. Send your invoice to the office the usual way for now.</p></div>
      )}

      {!unavailable && !editing && (
        <div className="card">
          {open.length > 0 ? (
            <>
              <p style={{ margin: '0 0 10px', fontSize: 14 }}>
                {open.length === 1 ? 'One pay period is' : `${open.length} pay periods are`} ready to invoice
                {': '}{open.slice(0, 3).map(periodName).join(', ')}{open.length > 3 ? '…' : ''}.
              </p>
              <button className="btn-primary" onClick={startNew} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Plus size={16} /> New invoice
              </button>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 14 }}>
              Nothing to invoice right now. When the office closes a pay period you worked in, it will appear here.
            </p>
          )}
        </div>
      )}

      {editing && (
        <form className="card" onSubmit={save}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>{editing === 'new' ? 'New invoice' : `Change invoice ${editingInvoice?.invoice_number || ''}`}</h2>

          {editingInvoice?.status === 'queried' && editingInvoice.office_note && (
            <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: '#FDF1DC', color: '#5C3A00', fontSize: 13.5 }}>
              <strong>The office asked:</strong> {editingInvoice.office_note}
            </div>
          )}

          <label htmlFor="si-period">Pay period</label>
          <select id="si-period" value={form.periodId} onChange={(e) => change({ periodId: e.target.value })} disabled={editing !== 'new'}>
            {editing === 'new' && <option value="">Choose…</option>}
            {choosable.map((p) => (
              <option key={p.id} value={p.id}>{periodName(p)} - {formatHours(p.minutes / 60)}</option>
            ))}
          </select>

          {form.periodId && (
            <details style={{ margin: '4px 0 12px', fontSize: 13 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--muted)' }}>
                {formatHours(minutes / 60)} on payroll - see the shifts
              </summary>
              {shiftsFor(form.periodId).map((s, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '3px 0' }}>
                  <span>{s.date ? new Date(`${s.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''} · {s.label}</span>
                  <span>{formatHours(s.minutes / 60)}</span>
                </div>
              ))}
              <p style={{ color: 'var(--muted)', margin: '6px 0 0' }}>Hours look wrong? Message the office before you send this.</p>
            </details>
          )}

          <label htmlFor="si-number">Your invoice number</label>
          <input id="si-number" value={form.invoiceNumber} onChange={(e) => change({ invoiceNumber: e.target.value })} placeholder="e.g. INV-001" maxLength={40} />

          <label htmlFor="si-rate">Your hourly rate (£)</label>
          <input id="si-rate" inputMode="decimal" value={form.hourlyRate} onChange={(e) => change({ hourlyRate: e.target.value })} placeholder="e.g. 15.00" />

          <label htmlFor="si-business">Your name or business name</label>
          <input id="si-business" value={form.businessName} onChange={(e) => change({ businessName: e.target.value })} placeholder="As it should appear on the invoice" maxLength={120} />

          <label htmlFor="si-address">Your address</label>
          <textarea id="si-address" rows={2} value={form.businessAddress} onChange={(e) => change({ businessAddress: e.target.value })} maxLength={400} />

          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Extras <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional - e.g. materials or travel)</span></div>
            {form.extras.map((ex, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <input aria-label="What it's for" value={ex.description} onChange={(e) => changeExtra(i, { description: e.target.value })} placeholder="What it's for" style={{ flex: 2, minWidth: 0, margin: 0 }} maxLength={200} />
                <input aria-label="Amount (£)" inputMode="decimal" value={ex.amount} onChange={(e) => changeExtra(i, { amount: e.target.value })} placeholder="£" style={{ flex: 1, minWidth: 0, margin: 0 }} />
                <button type="button" className="btn-secondary btn-compact" aria-label="Remove line"
                  onClick={() => change({ extras: form.extras.length > 1 ? form.extras.filter((_, j) => j !== i) : [emptyExtra()] })}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            {form.extras.length < MAX_EXTRAS && (
              <button type="button" className="btn-secondary btn-compact" onClick={() => change({ extras: [...form.extras, emptyExtra()] })}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Plus size={14} /> Add a line
              </button>
            )}
          </div>

          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 400, marginTop: 14 }}>
            <input type="checkbox" checked={form.chargeVat} onChange={(e) => change({ chargeVat: e.target.checked })} style={{ width: 'auto', margin: 0 }} />
            I'm VAT registered - add VAT at 20%
          </label>
          {form.chargeVat && (
            <>
              <label htmlFor="si-vat">VAT number</label>
              <input id="si-vat" value={form.vatNumber} onChange={(e) => change({ vatNumber: e.target.value })} placeholder="e.g. GB123456789" maxLength={30} />
            </>
          )}

          <label htmlFor="si-notes">Notes for the office <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
          <textarea id="si-notes" rows={2} value={form.notes} onChange={(e) => change({ notes: e.target.value })} maxLength={2000} />

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Your own invoice <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional - PDF or photo)</span></div>
            {currentAttachmentName ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <Paperclip size={14} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{currentAttachmentName}</span>
                <button type="button" className="btn-secondary btn-compact" aria-label="Remove file"
                  onClick={() => { setFile(null); if (editingInvoice?.attachment_path) setRemoveAttachment(true); }}>
                  <X size={14} />
                </button>
              </div>
            ) : (
              <input type="file" accept="application/pdf,image/*" onChange={pickFile} />
            )}
          </div>

          <div style={{ marginTop: 16, padding: '10px 12px', borderRadius: 8, background: 'var(--wf-paper, #F5F6F7)', fontSize: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{formatHours(minutes / 60)} × {formatMoney(parseMoney(form.hourlyRate) || 0)}</span><span>{formatMoney(preview.hoursAmount)}</span></div>
            {preview.extrasTotal !== 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Extras</span><span>{formatMoney(preview.extrasTotal)}</span></div>}
            {form.chargeVat && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>VAT</span><span>{formatMoney(preview.vatAmount)}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 4 }}><span>Total</span><span>{formatMoney(preview.total)}</span></div>
          </div>

          {error && <p style={{ color: '#A3152A', fontSize: 14, margin: '10px 0 0' }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Sending…' : editing === 'new' ? 'Send invoice' : 'Send again'}</button>
            <button type="button" className="btn-secondary" onClick={cancel} disabled={saving}>Cancel</button>
          </div>
        </form>
      )}

      {invoices.length > 0 && (
        <>
          <h2 style={{ fontSize: 17, margin: '20px 0 8px' }}>Sent</h2>
          {invoices.map((invoice) => (
            <div key={invoice.id} className="card">
              <SubcontractorInvoiceView invoice={invoice} shifts={shiftsFor(invoice.period_id)} />
              {canEdit(invoice) && editing !== invoice.id && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button type="button" className={invoice.status === 'queried' ? 'btn-primary btn-compact' : 'btn-secondary btn-compact'} onClick={() => startEdit(invoice)}>
                    {invoice.status === 'queried' ? 'Answer and resend' : 'Change'}
                  </button>
                  <button type="button" className="btn-secondary btn-compact" onClick={() => withdraw(invoice)}>Withdraw</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
