// Makes a client's QuickBooks UK invoice import file for a month - the same
// file as "Download for QuickBooks" on /admin/invoices. Read-only on the
// database. Run by the monthly "TKR invoice" scheduled task on the 30th.
//
//   node --dns-result-order=ipv4first scripts/invoice-csv.mjs <.env.local> <out dir> [--client "TKR Management"] [--month YYYY-MM] [--force]
//
// Without --month it looks at last month and this month (UK time) and makes
// any invoice whose invoicing day has come in the last 10 days and whose
// file isn't in <out dir> yet - so if the computer was off on the 30th the
// next run catches up, and a second run the same day does nothing. With
// nothing to make it prints NOTHING_DUE and exits 0. --month YYYY-MM
// --force makes that month's file regardless.
// Prints one line of JSON per file made.
import fs from 'fs';
import path from 'path';
import { buildInvoiceBreakdown, invoicePeriod, quickbooksRows, QUICKBOOKS_COLUMNS } from '../lib/invoiceBreakdown.js';
import { toCSV } from '../lib/csv.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const [envPath, outDir] = args;
const clientName = flag('--client') || 'TKR Management';
const product = flag('--product') || 'Cleaning';
const force = args.includes('--force');
const todayUK = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()); // YYYY-MM-DD
const thisMonth = todayUK.slice(0, 7);
const [ty, tm] = thisMonth.split('-').map(Number);
const lastMonth = tm === 1 ? `${ty - 1}-12` : `${ty}-${String(tm - 1).padStart(2, '0')}`;
const months = flag('--month') ? [flag('--month')] : [lastMonth, thisMonth];

const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const get = async (p) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${p}`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return JSON.parse(text);
};

const [client] = await get(`clients?select=id,name,hourly_rate&name=eq.${encodeURIComponent(clientName)}`);
if (!client) { console.error(`No client called ${clientName}`); process.exit(1); }
if (client.hourly_rate == null) { console.error(`${clientName} has no hourly rate`); process.exit(1); }
const properties = await get(`properties?select=id,address&client_id=eq.${client.id}`);
const sel = 'id,property_id,scheduled_at,status,duration_minutes,room_refreshes,hours_review_needed,job_assignments(cleaner_id)';
const rate = Number(client.hourly_rate);
const daysSince = (isoDay) => (Date.parse(`${todayUK}T00:00:00Z`) - Date.parse(`${isoDay}T00:00:00Z`)) / 86400000;

let made = 0;
for (const month of months) {
  const period = invoicePeriod(month);
  if (!period) { console.error(`Bad month: ${month}`); process.exit(1); }
  const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const invoiceNo = `${client.name.split(/\s+/)[0].toUpperCase()}-${month}`;
  const file = path.join(outDir, `${client.name} ${monthName} invoice ${invoiceNo}.csv`);
  if (!force) {
    const since = daysSince(period.invoiceDay);
    if (since < 0 || since > 10 || fs.existsSync(file)) continue;
  }

  const jobs = properties.length === 0 ? [] : await get(`jobs?select=${encodeURIComponent(sel)}&property_id=in.(${properties.map((p) => p.id).join(',')})&scheduled_at=gte.${period.start}&scheduled_at=lt.${period.end}`);
  const breakdown = buildInvoiceBreakdown({ properties, jobs, rate });
  const rows = quickbooksRows(breakdown, { invoiceNo, customer: client.name, invoiceDate: period.invoiceDay, item: product, rate, memo: `HMO Cleaning - ${monthName}` });

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(file, `${toCSV(QUICKBOOKS_COLUMNS, rows)}\n`);
  made += 1;
  console.log(JSON.stringify({
    file, invoiceNo, invoiceDay: period.invoiceDay, covers: period.covers,
    lines: rows.length, visits: breakdown.lines.reduce((t, l) => t + l.visits.length, 0), refreshes: breakdown.refreshes.length,
    cleaningTotal: breakdown.cleaningTotal, refreshTotal: breakdown.refreshTotal, total: breakdown.total, warnings: breakdown.warnings,
  }));
}
if (made === 0) console.log(`NOTHING_DUE today=${todayUK}`);
