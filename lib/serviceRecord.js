// Proof of service for the client portal: one row per visit in a month,
// with when the cleaner arrived and left, time on site, who cleaned and
// how much of the checklist was ticked. Any client can download it for
// their own audits; it carries no prices or hours rates.

import { minutesOnSite, formatDuration } from './detailedReport';

const LONDON = 'Europe/London';

const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: LONDON });
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: LONDON }) : '');

export const STATUS_LABELS = {
  completed: 'Done',
  in_progress: 'Under way',
  missed: 'Missed',
  scheduled: 'Booked',
  cancelled: 'Cancelled',
};

// jobs: [{ id, scheduled_at, status, properties: { address },
//          job_assignments: [{ profiles: { full_name } }],
//          checkins: [{ checked_in_at, checked_out_at, profiles: { full_name } }],
//          tasks: [{ completed }] }]
// Visits still to come are left out: this is a record of what happened.
export function serviceRecordRows(jobs, now = new Date()) {
  return [...(jobs || [])]
    .filter((j) => j.status !== 'cancelled')
    .filter((j) => j.status !== 'scheduled' || new Date(j.scheduled_at) <= now)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .map((j) => {
      const checkins = (j.checkins || []).filter((c) => c.checked_in_at);
      const arrived = checkins.map((c) => c.checked_in_at).sort()[0] || null;
      const lefts = checkins.map((c) => c.checked_out_at).filter(Boolean).sort();
      const left = lefts.length === checkins.length && lefts.length ? lefts[lefts.length - 1] : null;
      const fromCheckins = checkins.map((c) => c.profiles?.full_name).filter(Boolean);
      const fromRota = (j.job_assignments || []).map((a) => a.profiles?.full_name).filter(Boolean);
      const cleaners = [...new Set(fromCheckins.length ? fromCheckins : fromRota)];
      const tasks = j.tasks || [];
      const minutes = minutesOnSite(checkins);
      return {
        id: j.id,
        date: day(j.scheduled_at),
        address: j.properties?.address || '',
        status: STATUS_LABELS[j.status] || j.status,
        arrived: clock(arrived),
        left: clock(left),
        minutes,
        onSite: minutes > 0 ? formatDuration(minutes) : '',
        cleaners: cleaners.join(', '),
        checklist: tasks.length ? `${tasks.filter((t) => t.completed).length} of ${tasks.length}` : '',
      };
    });
}

export function serviceRecordTotals(rows) {
  const done = rows.filter((r) => r.status === STATUS_LABELS.completed);
  return {
    visits: done.length,
    missed: rows.filter((r) => r.status === STATUS_LABELS.missed).length,
    minutes: done.reduce((t, r) => t + r.minutes, 0),
  };
}

const CSV_COLUMNS = [
  ['Date', 'date'], ['Site', 'address'], ['Status', 'status'], ['Arrived', 'arrived'],
  ['Left', 'left'], ['Time on site', 'onSite'], ['Cleaner', 'cleaners'], ['Checklist ticked', 'checklist'],
];

function cell(value) {
  const s = String(value ?? '');
  // Quote anything with a comma, quote or newline; and stop a leading
  // = + - @ being run as a formula when the file is opened in Excel.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function serviceRecordCsv(rows) {
  const lines = [CSV_COLUMNS.map(([h]) => h).join(',')];
  rows.forEach((r) => lines.push(CSV_COLUMNS.map(([, k]) => cell(r[k])).join(',')));
  return `${lines.join('\r\n')}\r\n`;
}
