// Makes a client's QuickBooks UK invoice import file for a month - the same
// file as "Download for QuickBooks" on /admin/invoices. Read-only on the
// database. Run by the monthly "TKR invoice" scheduled task on the 30th.
//
//   node --dns-result-order=ipv4first scripts/invoice-csv.mjs <.env.local> <out dir> [--client "TKR Management"] [--month YYYY-MM] [--force]
//
// Without --month it uses this month (UK time). Without --force it only
// makes the file on that month's invoicing day, and otherwise prints
// NOT_INVOICING_DAY and exits 0 - the task runs daily from the 26th.
// Prints one line of JSON describing what it made.
import fs from 'fs';
import path from 'path';
import { buildInvoiceBreakdown, invoicePeriod, quickbooksRows, QUICKBOOKS_COLUMNS } from '../lib/invoiceBreakdown.js';
import { toCSV } from '../lib/csv.js';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const [envPath, outDir] = args;
const clientName = flag('--client') || 'TKR Management';
const product = flag('--product') || 'Cleaning';
const todayUK = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date()); // YYYY-MM-DD
const month = flag('--month') || todayUK.slice(0, 7);

const period = invoicePeriod(month);
if (!period) { console.error(`Bad month: ${month}`); process.exit(1); }
if (!args.includes('--force') && period.invoiceDay !== todayUK) {
  console.log(`NOT_INVOICING_DAY today=${todayUK} invoiceDay=${period.invoiceDay}`);
  process.exit(0);
}

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
const jobs = properties.length === 0 ? [] : await get(`jobs?select=${encodeURIComponent(sel)}&property_id=in.(${properties.map((p) => p.id).join(',')})&scheduled_at=gte.${period.start}&scheduled_at=lt.${period.end}`);

const rate = Number(client.hourly_rate);
const breakdown = buildInvoiceBreakdown({ properties, jobs, rate });
const monthName = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const invoiceNo = `${client.name.split(/\s+/)[0].toUpperCase()}-${month}`;
const rows = quickbooksRows(breakdown, { invoiceNo, customer: client.name, invoiceDate: period.invoiceDay, item: product, rate, memo: `HMO Cleaning - ${monthName}` });

fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${client.name} ${monthName} invoice ${invoiceNo}.csv`);
fs.writeFileSync(file, `${toCSV(QUICKBOOKS_COLUMNS, rows)}\n`);
console.log(JSON.stringify({
  file, invoiceNo, invoiceDay: period.invoiceDay, covers: period.covers,
  lines: rows.length, visits: breakdown.lines.reduce((t, l) => t + l.visits.length, 0), refreshes: breakdown.refreshes.length,
  cleaningTotal: breakdown.cleaningTotal, refreshTotal: breakdown.refreshTotal, total: breakdown.total, warnings: breakdown.warnings,
}));
