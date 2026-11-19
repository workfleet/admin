// Subcontractor invoices (0154): a subcontractor bills us for a closed pay
// period through the app. Shared by their page (app/cleaner/invoices), the
// office's page (app/admin/subcontractor-invoices) and the PDF route.
//
// The database works the money out for itself on every write
// (subcontractor_invoice_before_write) - minutes from payroll, then hours x
// rate + extras, then VAT. computeTotals below is the same arithmetic for the
// form's running total, so what someone sees before sending is what gets
// saved. Change one, change the other.

export const INVOICE_COLUMNS = [
  'id', 'subcontractor_id', 'subcontractor_name', 'period_id', 'period_start', 'period_end',
  'invoice_number', 'business_name', 'business_address', 'vat_number', 'hourly_rate',
  'extras', 'vat_rate', 'notes', 'attachment_path', 'attachment_name',
  'minutes', 'hours_amount', 'extras_total', 'subtotal', 'vat_amount', 'total',
  'status', 'office_note', 'submitted_at', 'decided_at', 'paid_at', 'created_at', 'updated_at',
].join(', ');

export const VAT_RATE = 20;
export const MAX_EXTRAS = 20;
export const ATTACHMENT_BUCKET = 'subcontractor-invoices';
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const STATUS = {
  submitted: { label: 'Sent', badge: 'in_progress', help: 'With the office to check.' },
  queried: { label: 'Query', badge: 'queried', help: 'The office has a question - see their note, change anything that needs it and send it again.' },
  approved: { label: 'Approved', badge: 'completed', help: 'Approved - waiting to be paid.' },
  paid: { label: 'Paid', badge: 'completed', help: 'Paid.' },
  withdrawn: { label: 'Withdrawn', badge: 'scheduled', help: 'Withdrawn - you can send a new one for this period.' },
};

export function statusInfo(status) {
  return STATUS[status] || { label: status || 'Unknown', badge: 'scheduled', help: '' };
}

// Still open to the subcontractor: they can change, resend or withdraw it.
export function canEdit(invoice) {
  return invoice?.status === 'submitted' || invoice?.status === 'queried';
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// A typed amount ('12.5', '£12.50', '1,200') to a number, or null.
export function parseMoney(value) {
  const cleaned = String(value ?? '').replace(/[£,\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '.' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? round2(n) : null;
}

export function formatMoney(value) {
  const n = Number(value) || 0;
  return `${n < 0 ? '-' : ''}£${Math.abs(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// The arithmetic in subcontractor_invoice_before_write, step for step:
// hours amount rounded on its own, extras rounded each, VAT rounded on the
// subtotal.
export function computeTotals({ minutes, hourlyRate, extras = [], vatRate = 0 }) {
  const rate = Number(hourlyRate) || 0;
  const hoursAmount = round2((Number(minutes) || 0) / 60 * rate);
  const extrasTotal = round2(extras.reduce((sum, e) => sum + round2(Number(e.amount) || 0), 0));
  const subtotal = round2(hoursAmount + extrasTotal);
  const vatAmount = round2(subtotal * (Number(vatRate) || 0) / 100);
  return { hoursAmount, extrasTotal, subtotal, vatAmount, total: round2(subtotal + vatAmount) };
}

export function emptyExtra() {
  return { description: '', amount: '' };
}

// The form's extra lines to what is saved: blank rows dropped, amounts as
// numbers. Returns { extras } or { error }.
export function extrasFromForm(rows) {
  const extras = [];
  for (const row of rows || []) {
    const description = String(row.description ?? '').trim();
    const amountText = String(row.amount ?? '').trim();
    if (!description && !amountText) continue;
    if (!description) return { error: 'Each extra line needs a description.' };
    const amount = parseMoney(amountText);
    if (amount === null) return { error: `Enter an amount for "${description}".` };
    if (Math.abs(amount) > 10000) return { error: 'An extra line cannot be more than £10,000.' };
    extras.push({ description: description.slice(0, 200), amount });
  }
  if (extras.length > MAX_EXTRAS) return { error: `An invoice can have at most ${MAX_EXTRAS} extra lines.` };
  return { extras };
}

// Form state to the columns the subcontractor writes. The trigger fills in
// the rest. Returns { row } or { error } in the words they should see.
export function rowFromForm(form, { minutes = 0 } = {}) {
  if (!form.periodId) return { error: 'Choose the pay period this invoice is for.' };
  const invoiceNumber = String(form.invoiceNumber ?? '').trim();
  if (!invoiceNumber) return { error: 'Give the invoice a number - whatever you use in your own records, e.g. INV-001.' };
  if (invoiceNumber.length > 40) return { error: 'The invoice number is too long.' };

  const hourlyRate = parseMoney(form.hourlyRate);
  if (hourlyRate === null || hourlyRate <= 0) return { error: 'Enter your hourly rate, e.g. 15.00.' };
  if (hourlyRate > 200) return { error: 'That hourly rate looks too high - check it.' };

  const { extras, error } = extrasFromForm(form.extras);
  if (error) return { error };

  const vatRate = form.chargeVat ? VAT_RATE : 0;
  const vatNumber = String(form.vatNumber ?? '').trim();
  if (vatRate && !vatNumber) return { error: 'Add your VAT number to charge VAT.' };

  if (!(Number(minutes) > 0) && extras.every((e) => e.amount === 0)) {
    return { error: 'There are no hours on payroll for you in that period.' };
  }

  const text = (v, max) => {
    const t = String(v ?? '').trim();
    return t ? t.slice(0, max) : null;
  };

  return {
    row: {
      period_id: form.periodId,
      invoice_number: invoiceNumber,
      business_name: text(form.businessName, 120),
      business_address: text(form.businessAddress, 400),
      vat_number: vatRate ? vatNumber.slice(0, 30) : null,
      hourly_rate: hourlyRate,
      extras,
      vat_rate: vatRate,
      notes: text(form.notes, 2000),
    },
  };
}

// A saved invoice back into the form, to change and resend it.
export function formFromInvoice(invoice) {
  return {
    periodId: invoice.period_id,
    invoiceNumber: invoice.invoice_number || '',
    businessName: invoice.business_name || '',
    businessAddress: invoice.business_address || '',
    vatNumber: invoice.vat_number || '',
    chargeVat: Number(invoice.vat_rate) > 0,
    hourlyRate: invoice.hourly_rate != null ? Number(invoice.hourly_rate).toFixed(2) : '',
    extras: (invoice.extras || []).length
      ? invoice.extras.map((e) => ({ description: e.description, amount: Number(e.amount).toFixed(2) }))
      : [emptyExtra()],
    notes: invoice.notes || '',
  };
}

// A fresh form, carrying over who they are and their rate from their last
// invoice, and suggesting the next number in their own sequence.
export function newForm(previous) {
  return {
    periodId: '',
    invoiceNumber: previous ? nextInvoiceNumber(previous.invoice_number) : '',
    businessName: previous?.business_name || '',
    businessAddress: previous?.business_address || '',
    vatNumber: previous?.vat_number || '',
    chargeVat: Number(previous?.vat_rate) > 0,
    hourlyRate: previous?.hourly_rate != null ? Number(previous.hourly_rate).toFixed(2) : '',
    extras: [emptyExtra()],
    notes: '',
  };
}

// 'INV-007' -> 'INV-008', '41' -> '42'. Anything without a trailing number
// is left for them to fill in.
export function nextInvoiceNumber(last) {
  const match = String(last ?? '').match(/^(.*?)(\d+)$/);
  if (!match) return '';
  const [, prefix, digits] = match;
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  return `${prefix}${next}`;
}

// Pay periods a subcontractor can invoice: closed periods they have payroll
// minutes in, with no live (not withdrawn) invoice already. Takes their
// payroll_period_lines rows (with the payroll_periods embed) and adjustment
// rows (with the `period` embed), newest first.
export function invoiceablePeriods(lineRows, adjustmentRows, invoices) {
  const byId = new Map();
  const add = (period, minutes) => {
    if (!period?.id) return;
    const entry = byId.get(period.id) || { id: period.id, start: period.period_start, end: period.period_end, minutes: 0 };
    entry.minutes += Number(minutes) || 0;
    byId.set(period.id, entry);
  };
  (lineRows || []).forEach((l) => add(Array.isArray(l.payroll_periods) ? l.payroll_periods[0] : l.payroll_periods, l.minutes));
  (adjustmentRows || []).forEach((a) => add(Array.isArray(a.period) ? a.period[0] : a.period, a.minutes));

  const taken = new Set((invoices || []).filter((i) => i.status !== 'withdrawn').map((i) => i.period_id));
  return [...byId.values()]
    .filter((p) => p.minutes > 0 && !taken.has(p.id))
    .sort((a, b) => (a.start < b.start ? 1 : -1));
}

export function invoiceFileName(invoice) {
  const who = String(invoice?.subcontractor_name || 'subcontractor').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const num = String(invoice?.invoice_number || invoice?.id || '').replace(/[^A-Za-z0-9-]+/g, '-');
  return `Invoice-${who}-${num}.pdf`;
}

// Storage path for an attached file: under their own folder (the bucket's
// policy keys on it), with a timestamp so a replacement never collides.
export function attachmentPath(userId, fileName, now = Date.now()) {
  const safe = String(fileName || 'invoice').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  return `${userId}/${now}-${safe}`;
}

// payroll_period_lines + included adjustments to the shift list on an invoice.
export function shiftsFromPayroll(lines, adjustments) {
  const out = (lines || []).map((l) => ({
    date: l.job_date,
    label: l.kind === 'holiday' ? 'Holiday' : (l.job_address || 'Shift'),
    minutes: Number(l.minutes) || 0,
  }));
  (adjustments || []).forEach((a) => out.push({
    date: a.job_date,
    label: `Correction: ${a.job_address || a.reason || 'earlier shift'}`,
    minutes: Number(a.minutes) || 0,
  }));
  return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}
