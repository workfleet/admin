'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Paperclip } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { formatHours } from '../../lib/hoursWorked';
import { periodLabel, monthLabelIfWhole } from '../../lib/payroll';
import { ATTACHMENT_BUCKET, formatMoney, invoiceFileName, statusInfo, shiftsFromPayroll } from '../../lib/subcontractorInvoices';

export { shiftsFromPayroll };

// One subcontractor invoice (0154), read-only: the same breakdown for the
// subcontractor and for the office, so both are looking at the same thing
// when there is a question about it. Actions sit outside, in each page.

export function InvoiceStatusBadge({ status }) {
  const info = statusInfo(status);
  return <span className={`badge ${info.badge}`}>{info.label}</span>;
}

export function invoicePeriodLabel(invoice) {
  if (!invoice?.period_start || !invoice?.period_end) return 'Pay period';
  const period = { start: invoice.period_start, end: invoice.period_end };
  return monthLabelIfWhole(period) || periodLabel(period);
}

async function downloadPdf(invoice) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return 'Your session has ended - sign in again.';
  const res = await fetch(`/api/subcontractor-invoices/${invoice.id}/pdf`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!res.ok) return 'Could not make the PDF. Try again in a moment.';
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = invoiceFileName(invoice);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return null;
}

async function openAttachment(path) {
  // Open the tab first: a window opened after an await is blocked as a
  // pop-up on phones.
  const win = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) {
    win?.close();
    return 'Could not open the file.';
  }
  if (win) win.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
  return null;
}

const row = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: 14 };
const muted = { color: 'var(--muted)' };

export default function SubcontractorInvoiceView({ invoice, shifts, showWho = false }) {
  const [showShifts, setShowShifts] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const info = statusInfo(invoice.status);

  const run = async (fn) => {
    setBusy(true);
    setMessage('');
    const err = await fn();
    setBusy(false);
    if (err) setMessage(err);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          {showWho && <div style={{ fontWeight: 700, fontSize: 16 }}>{invoice.subcontractor_name || 'Subcontractor'}</div>}
          <div style={{ fontWeight: showWho ? 500 : 700, fontSize: showWho ? 14 : 16 }}>
            Invoice {invoice.invoice_number}
          </div>
          <div style={{ ...muted, fontSize: 13 }}>{invoicePeriodLabel(invoice)}</div>
        </div>
        <InvoiceStatusBadge status={invoice.status} />
      </div>

      {(invoice.business_name || invoice.business_address) && (
        <p style={{ fontSize: 13, margin: '10px 0 0', whiteSpace: 'pre-line' }}>
          {[invoice.business_name, invoice.business_address].filter(Boolean).join('\n')}
        </p>
      )}

      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)' }}>
        <div style={row}>
          <span>
            {formatHours(Number(invoice.minutes) / 60)} at {formatMoney(invoice.hourly_rate)}/hr
          </span>
          <span>{formatMoney(invoice.hours_amount)}</span>
        </div>
        {(invoice.extras || []).map((e, i) => (
          <div key={i} style={row}>
            <span>{e.description}</span>
            <span>{formatMoney(e.amount)}</span>
          </div>
        ))}
        {Number(invoice.vat_rate) > 0 && (
          <>
            <div style={{ ...row, borderTop: '1px solid var(--border)' }}>
              <span style={muted}>Subtotal</span><span>{formatMoney(invoice.subtotal)}</span>
            </div>
            <div style={row}>
              <span style={muted}>VAT at {Number(invoice.vat_rate)}%{invoice.vat_number ? ` (${invoice.vat_number})` : ''}</span>
              <span>{formatMoney(invoice.vat_amount)}</span>
            </div>
          </>
        )}
        <div style={{ ...row, borderTop: '1px solid var(--border)', fontWeight: 700, fontSize: 15 }}>
          <span>Total</span><span>{formatMoney(invoice.total)}</span>
        </div>
      </div>

      {shifts && shifts.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={() => setShowShifts((v) => !v)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            {showShifts ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {shifts.length} {shifts.length === 1 ? 'shift' : 'shifts'} from payroll
          </button>
          {showShifts && (
            <div style={{ marginTop: 6 }}>
              {shifts.map((s, i) => (
                <div key={i} style={{ ...row, fontSize: 13, padding: '4px 0' }}>
                  <span>
                    {s.date ? new Date(`${s.date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}
                    {' · '}{s.label}
                  </span>
                  <span style={{ whiteSpace: 'nowrap' }}>{formatHours(s.minutes / 60)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {invoice.notes && (
        <p style={{ fontSize: 13.5, margin: '12px 0 0', whiteSpace: 'pre-line' }}>
          <span style={muted}>Notes: </span>{invoice.notes}
        </p>
      )}

      {invoice.office_note && (invoice.status === 'queried' || showWho) && (
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: '#FDF1DC', color: '#5C3A00', fontSize: 13.5 }}>
          <strong>Office note:</strong> {invoice.office_note}
        </div>
      )}

      <p style={{ ...muted, fontSize: 12.5, margin: '12px 0 0' }}>
        {info.help}
        {' '}Sent {new Date(invoice.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        {invoice.paid_at && ` · paid ${new Date(invoice.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <button type="button" className="btn-secondary btn-compact" disabled={busy} onClick={() => run(() => downloadPdf(invoice))}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Download size={14} /> PDF
        </button>
        {invoice.attachment_path && (
          <button type="button" className="btn-secondary btn-compact" disabled={busy} onClick={() => run(() => openAttachment(invoice.attachment_path))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Paperclip size={14} /> {invoice.attachment_name || 'Attached invoice'}
          </button>
        )}
      </div>
      {message && <p style={{ color: 'var(--danger, #A3152A)', fontSize: 13, margin: '8px 0 0' }}>{message}</p>}
    </div>
  );
}
