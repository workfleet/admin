// With the extension so the monthly scheduled task can import this file
// straight into Node, outside Next.
import { shortAddress } from './shortAddress.js';

// What goes on a client's monthly invoice: each property with its visit
// dates, and room refreshes on their own lines, each charged at the
// client's hourly rate. TKR Management asked for exactly this layout
// (October 2026); the office copies it into the QuickBooks invoice.
//
// Charged on the booked length of the visit, not clocked time - that's
// what was agreed with the client, and a cleaner finishing ten minutes
// early or late shouldn't change the bill. Booked time spent on a room
// refresh comes off the ordinary clean so it isn't charged twice.

export const BILLABLE_STATUSES = ['completed', 'in_progress'];

// Jess invoices on the 30th (see invoicingDay), at 9am. Visits later that
// day, or after it in the month, go on the next invoice - so an invoice
// covers from the start of last month's invoicing day to the start of this
// month's, and every visit is charged exactly once.

// Easter Sunday (anonymous Gregorian algorithm), as [monthIndex, day].
function easterSunday(year) {
  const a = year % 19; const b = Math.floor(year / 100); const c = year % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return [month - 1, ((h + l - 7 * m + 114) % 31) + 1];
}

// England and Wales bank holidays that can fall at the end of a month:
// Good Friday and Easter Monday (end of March or April), and the last
// Mondays of May and August. Christmas and Boxing Day never reach the
// 30th of December.
export function isEndOfMonthBankHoliday(year, monthIndex, day) {
  const dt = new Date(Date.UTC(year, monthIndex, day));
  const [em, ed] = easterSunday(year);
  const easter = Date.UTC(year, em, ed);
  const t = dt.getTime();
  if (t === easter - 2 * 86400000 || t === easter + 86400000) return true;
  if ((monthIndex === 4 || monthIndex === 7) && dt.getUTCDay() === 1) {
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    return day + 7 > daysInMonth;
  }
  return false;
}

// [year, monthIndex, day] TKR get their invoice: the 30th (the last day in
// February), or the working day before it if that's a weekend or bank
// holiday - "they need the invoices on the 30th" (Jess, 2026-10-14).
export function invoicingDay(year, monthIndex) {
  let day = Math.min(30, new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate());
  for (;;) {
    const dow = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
    if (dow !== 0 && dow !== 6 && !isEndOfMonthBankHoliday(year, monthIndex, day)) return [year, monthIndex, day];
    day -= 1;
  }
}

// Midnight UK time on that date, as an instant.
function londonMidnight(year, monthIndex, day) {
  const utc = Date.UTC(year, monthIndex, day);
  const hourInLondon = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' }).format(new Date(utc)));
  return new Date(utc - hourInLondon * 3600000);
}

// month is 'YYYY-MM': the invoice sent on that month's last working day.
export function invoicePeriod(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  const from = invoicingDay(index === 0 ? year - 1 : year, index === 0 ? 11 : index - 1);
  const to = invoicingDay(year, index);
  const start = londonMidnight(...from);
  const end = londonMidnight(...to);
  const dayBefore = new Date(Date.UTC(to[0], to[1], to[2] - 1));
  const label = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    invoiceDay: `${to[0]}-${String(to[1] + 1).padStart(2, '0')}-${String(to[2]).padStart(2, '0')}`,
    covers: `${label(new Date(Date.UTC(...from)))} to ${label(dayBefore)}`,
  };
}

export function invoiceDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London',
  });
}

// dd/mm/yyyy in UK time - the date format QuickBooks UK shows and imports.
export function ukDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/London' });
}

// Rooms refreshed on a visit, with anything malformed dropped.
export function refreshesOf(job) {
  const list = Array.isArray(job?.room_refreshes) ? job.room_refreshes : [];
  return list
    .map((r) => ({ room: String(r?.room || '').trim(), minutes: Math.max(0, Math.round(Number(r?.minutes) || 0)) }))
    .filter((r) => r.room && r.minutes > 0);
}

// Swansea Bus Station isn't billed by the hour: it pays a set price per
// shift, with one line per kind of shift - copied from Jess's September
// QuickBooks invoice (2026-10-30). Quantity is the number of shifts, however
// long the booking or however many cleaners were on it. Nights start from
// 11pm to 2am and days 10am or 2pm, so anything from 8pm to before 6am UK
// time is a night.
const londonParts = (iso) => {
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', hourCycle: 'h23', timeZone: 'Europe/London' }).formatToParts(new Date(iso));
  return { weekday: parts.find((p) => p.type === 'weekday').value, hour: Number(parts.find((p) => p.type === 'hour').value) };
};

export const SHIFT_PRICING = {
  'Swansea Bus Station': {
    title: 'Commercial Cleans',
    item: 'Commercial Cleans',
    // The customer's name in QuickBooks, which the import has to match.
    customer: 'Swansea Bus Station - Swansea Council',
    shifts: [
      { key: 'day', label: 'Day shift cleaning - 2pm - 6pm', price: 97.08, usualHour: 14 },
      { key: 'night', label: 'Early hours shift cleaning - 11pm - 5am', price: 105 },
      { key: 'saturday', label: 'Saturday shift cleaning - 10am - 6pm', price: 194.16, usualHour: 10 },
      { key: 'sunday', label: 'Sunday shift cleaning - 10am - 4pm', price: 145.62, usualHour: 10 },
    ],
    shiftOf(iso) {
      const { weekday, hour } = londonParts(iso);
      if (hour >= 20 || hour < 6) return 'night';
      if (weekday === 'Sat') return 'saturday';
      if (weekday === 'Sun') return 'sunday';
      return 'day';
    },
  },
};

export const shiftPricingFor = (clientName) => SHIFT_PRICING[clientName] || null;

// Visits already filtered to the billable ones, priced per shift.
function buildShiftLines(visits, pricing) {
  const warnings = [];
  const lines = pricing.shifts.map((s) => ({ ...s, id: s.key, name: s.label, visits: [], minutes: 0, quantity: 0, unitPrice: s.price, amount: 0 }));
  const seen = new Set();
  for (const v of visits) {
    const line = lines.find((l) => l.key === pricing.shiftOf(v.scheduledAt));
    const { hour } = londonParts(v.scheduledAt);
    if (line.usualHour != null && hour !== line.usualHour) warnings.push(`${v.date}: a visit starting at ${hour}:00 is charged as a ${line.label.split(' cleaning')[0].toLowerCase()} - check it should be.`);
    if (seen.has(`${line.key}|${v.date}`)) warnings.push(`${v.date}: two ${line.label.split(' cleaning')[0].toLowerCase()}s that day, both charged - delete one on the rota if it's a duplicate.`);
    seen.add(`${line.key}|${v.date}`);
    line.visits.push(v);
    line.minutes += v.minutes;
  }
  for (const l of lines) {
    l.quantity = l.visits.length;
    l.amount = money(l.quantity * l.unitPrice);
  }
  return { lines: lines.filter((l) => l.quantity > 0), warnings };
}

const money = (n) => Math.round(n * 100) / 100;
const charge = (minutes, rate) => money((minutes / 60) * (Number(rate) || 0));

// pricing is a SHIFT_PRICING entry for a client billed per shift, else null.
export function buildInvoiceBreakdown({ properties, jobs, rate, pricing = null }) {
  const byProperty = new Map((properties || []).map((p) => [p.id, { id: p.id, address: p.address, name: shortAddress(p.address) || p.address, visits: [] }]));
  const refreshes = [];
  const warnings = [];
  let missed = 0;
  let notYetDone = 0;

  const sorted = [...(jobs || [])].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  for (const job of sorted) {
    const property = byProperty.get(job.property_id);
    if (!property) continue;
    if (job.status === 'missed') { missed += 1; continue; }
    if (!BILLABLE_STATUSES.includes(job.status)) { notYetDone += 1; continue; }

    const date = invoiceDate(job.scheduled_at);
    const booked = Math.max(0, Number(job.duration_minutes) || 0);
    const rooms = refreshesOf(job);
    const refreshMinutes = Math.min(booked, rooms.reduce((t, r) => t + r.minutes, 0));
    const cleanMinutes = booked - refreshMinutes;

    if (cleanMinutes > 0) property.visits.push({ jobId: job.id, date, minutes: cleanMinutes, scheduledAt: job.scheduled_at });
    let left = booked;
    for (const r of rooms) {
      const minutes = Math.min(r.minutes, left);
      left -= minutes;
      if (minutes > 0) refreshes.push({ jobId: job.id, room: r.room, property: property.name, date, serviceDate: ukDate(job.scheduled_at), minutes, amount: charge(minutes, rate) });
    }

    // A visit is charged once however many cleaners were on it - Jess
    // confirmed for TKR, 2026-10-14.
    if (job.hours_review_needed) warnings.push(`${property.name}, ${date}: this visit is waiting for an hours check on the rota.`);
  }

  if (missed > 0) warnings.push(`${missed} missed ${missed === 1 ? 'visit isn\'t' : 'visits aren\'t'} charged.`);
  if (notYetDone > 0) warnings.push(`${notYetDone} ${notYetDone === 1 ? 'visit this month hasn\'t' : 'visits this month haven\'t'} happened yet or ${notYetDone === 1 ? 'isn\'t' : 'aren\'t'} closed on the rota, so ${notYetDone === 1 ? 'it isn\'t' : 'they aren\'t'} included.`);

  let lines;
  if (pricing) {
    const shifted = buildShiftLines([...byProperty.values()].flatMap((p) => p.visits).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)), pricing);
    lines = shifted.lines;
    warnings.unshift(...shifted.warnings);
  } else {
    lines = [...byProperty.values()]
      .filter((p) => p.visits.length > 0)
      .map((p) => {
        const minutes = p.visits.reduce((t, v) => t + v.minutes, 0);
        return { ...p, minutes, amount: charge(minutes, rate) };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { numeric: true }));
  }

  const cleaningTotal = money(lines.reduce((t, l) => t + l.amount, 0));
  const refreshTotal = money(refreshes.reduce((t, r) => t + r.amount, 0));
  return { lines, refreshes, warnings, cleaningTotal, refreshTotal, total: money(cleaningTotal + refreshTotal) };
}

export function formatHours(minutes) {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, '')} ${h === 1 ? 'hr' : 'hrs'}`;
}

export const gbp = (n) => `£${(Number(n) || 0).toFixed(2)}`;

// The description for one property's line in QuickBooks, in the layout TKR
// sent: "Olive Street - 2 cleaning visits: 2 July 2026, 16 July 2026".
// A per-shift line is just its label, as on the Bus Station's invoice.
export function propertyLineText(line) {
  if (line.unitPrice != null) return line.label;
  const n = line.visits.length;
  return `${line.name} - ${n} cleaning ${n === 1 ? 'visit' : 'visits'}: ${line.visits.map((v) => v.date).join(', ')}`;
}

export function refreshLineText(r) {
  return `Room refresh - ${r.room}, ${r.property} - ${r.date}`;
}

// QuickBooks UK can import invoices from a CSV (Settings > Import data >
// Invoices) - the connector can't reach UK companies, so this is how the
// month gets in. One row per invoice line; rows sharing an invoice number
// become one invoice, and only the first carries the customer and dates.
// Headers copied exactly from QuickBooks UK's sample_invoice_import.csv
// (Jess downloaded it 2026-10-14) so the columns match without mapping.
// Not VAT registered, so the sample has no tax code column to fill.
export const QUICKBOOKS_COLUMNS = [
  { key: 'invoiceNo', label: '*InvoiceNo' },
  { key: 'customer', label: '*Customer' },
  { key: 'invoiceDate', label: '*InvoiceDate' },
  { key: 'dueDate', label: '*DueDate' },
  { key: 'terms', label: 'Terms' },
  { key: 'location', label: 'Location' },
  { key: 'memo', label: 'Memo' },
  { key: 'item', label: 'Item(Product/Service)' },
  { key: 'description', label: 'ItemDescription' },
  { key: 'quantity', label: 'ItemQuantity' },
  { key: 'rate', label: 'ItemRate' },
  { key: 'amount', label: '*ItemAmount' },
  { key: 'serviceDate', label: 'Service Date' },
  { key: 'note', label: 'Note to customer' },
];

const hoursQty = (minutes) => (minutes / 60).toFixed(2);

// invoiceDate is a yyyy-mm-dd string from a date input. Jess's invoices
// are due on receipt (2026-10-14), which QuickBooks' sample writes as
// "Due on receipt" with the due date the same as the invoice date.
export function quickbooksRows(breakdown, { invoiceNo, customer, invoiceDate, termsDays = 0, item, rate, memo = '' }) {
  const [y, m, d] = invoiceDate.split('-').map(Number);
  const fmt = (dt) => `${String(dt.getUTCDate()).padStart(2, '0')}/${String(dt.getUTCMonth() + 1).padStart(2, '0')}/${dt.getUTCFullYear()}`;
  const issued = new Date(Date.UTC(y, m - 1, d));
  const due = new Date(Date.UTC(y, m - 1, d + termsDays));
  const line = { invoiceNo, item, rate: (Number(rate) || 0).toFixed(2) };
  const rows = [
    ...breakdown.lines.map((l) => (l.unitPrice != null
      ? { ...line, rate: l.unitPrice.toFixed(2), serviceDate: '', description: propertyLineText(l), quantity: String(l.quantity), amount: l.amount.toFixed(2) }
      : { ...line, serviceDate: '', description: propertyLineText(l), quantity: hoursQty(l.minutes), amount: l.amount.toFixed(2) })),
    ...breakdown.refreshes.map((r) => ({ ...line, serviceDate: r.serviceDate, description: refreshLineText(r), quantity: hoursQty(r.minutes), amount: r.amount.toFixed(2) })),
  ];
  if (rows.length > 0) {
    Object.assign(rows[0], { customer, invoiceDate: fmt(issued), dueDate: fmt(due), terms: termsDays > 0 ? `Net ${termsDays}` : 'Due on receipt', memo });
  }
  return rows;
}

// The whole breakdown as plain text, laid out like TKR's example, for
// pasting into an email or the invoice's message box.
export function breakdownText(breakdown, monthName, rate, title = 'HMO Cleaning') {
  const out = [`${title} - ${monthName}`, ''];
  for (const line of breakdown.lines) {
    if (line.unitPrice != null) {
      out.push(`${line.label} (${line.quantity} at ${gbp(line.unitPrice)} = ${gbp(line.amount)})`);
      for (const v of line.visits) out.push(`  * ${v.date}`);
      out.push('');
      continue;
    }
    const n = line.visits.length;
    out.push(`${line.name} - ${n} cleaning ${n === 1 ? 'visit' : 'visits'} (${formatHours(line.minutes)} at ${gbp(rate)}/hr = ${gbp(line.amount)})`);
    for (const v of line.visits) out.push(`  * ${v.date}`);
    out.push('');
  }
  if (breakdown.refreshes.length > 0) {
    out.push('Room Refreshes', '');
    for (const r of breakdown.refreshes) out.push(`  * ${r.room}, ${r.property} - ${r.date} (${formatHours(r.minutes)} = ${gbp(r.amount)})`);
    out.push('');
  }
  out.push(`Cleaning: ${gbp(breakdown.cleaningTotal)}`);
  if (breakdown.refreshes.length > 0) out.push(`Room refreshes: ${gbp(breakdown.refreshTotal)}`);
  out.push(`Total: ${gbp(breakdown.total)}`);
  return out.join('\n');
}
