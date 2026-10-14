import { shortAddress } from './shortAddress';

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

export function invoiceDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London',
  });
}

// Rooms refreshed on a visit, with anything malformed dropped.
export function refreshesOf(job) {
  const list = Array.isArray(job?.room_refreshes) ? job.room_refreshes : [];
  return list
    .map((r) => ({ room: String(r?.room || '').trim(), minutes: Math.max(0, Math.round(Number(r?.minutes) || 0)) }))
    .filter((r) => r.room && r.minutes > 0);
}

const money = (n) => Math.round(n * 100) / 100;
const charge = (minutes, rate) => money((minutes / 60) * (Number(rate) || 0));

export function buildInvoiceBreakdown({ properties, jobs, rate }) {
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

    if (cleanMinutes > 0) property.visits.push({ jobId: job.id, date, minutes: cleanMinutes });
    let left = booked;
    for (const r of rooms) {
      const minutes = Math.min(r.minutes, left);
      left -= minutes;
      if (minutes > 0) refreshes.push({ jobId: job.id, room: r.room, property: property.name, date, minutes, amount: charge(minutes, rate) });
    }

    const cleaners = (job.job_assignments || []).length;
    if (cleaners > 1) warnings.push(`${property.name}, ${date}: ${cleaners} cleaners were on this visit but it's charged once, for the booked time. Change it on the invoice if you charge for each cleaner.`);
    if (job.hours_review_needed) warnings.push(`${property.name}, ${date}: this visit is waiting for an hours check on the rota.`);
  }

  if (missed > 0) warnings.push(`${missed} missed ${missed === 1 ? 'visit isn\'t' : 'visits aren\'t'} charged.`);
  if (notYetDone > 0) warnings.push(`${notYetDone} ${notYetDone === 1 ? 'visit this month hasn\'t' : 'visits this month haven\'t'} happened yet or ${notYetDone === 1 ? 'isn\'t' : 'aren\'t'} closed on the rota, so ${notYetDone === 1 ? 'it isn\'t' : 'they aren\'t'} included.`);

  const lines = [...byProperty.values()]
    .filter((p) => p.visits.length > 0)
    .map((p) => {
      const minutes = p.visits.reduce((t, v) => t + v.minutes, 0);
      return { ...p, minutes, amount: charge(minutes, rate) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en-GB', { numeric: true }));

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
export function propertyLineText(line) {
  const n = line.visits.length;
  return `${line.name} - ${n} cleaning ${n === 1 ? 'visit' : 'visits'}: ${line.visits.map((v) => v.date).join(', ')}`;
}

export function refreshLineText(r) {
  return `Room refresh - ${r.room}, ${r.property} - ${r.date}`;
}

// The whole breakdown as plain text, laid out like TKR's example, for
// pasting into an email or the invoice's message box.
export function breakdownText(breakdown, monthName, rate) {
  const out = [`HMO Cleaning - ${monthName}`, ''];
  for (const line of breakdown.lines) {
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
