// Which accident-book reminders are due today (0135). Pure, so the rules
// can be tested; app/api/admin/incident-reminders sends them.
//
// Each reminder has a key, recorded in incident_reminders_sent, so it goes
// once. A key that includes a date or a week number goes again when that
// changes (a new deadline, another week off work).

import {
  KIND_LABELS, riddorState, daysOffWork, londonDate, addDays, formatDay, wasInjured, isWorkerInjury, injuredPersonName,
} from './incidents';

function dayDiff(from, to) {
  const n = (d) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) / 86400000; };
  return n(to) - n(from);
}

function what(report) {
  const kind = (KIND_LABELS[report.kind] || 'Report').toLowerCase();
  const place = (report.location || '').slice(0, 50);
  return `the ${kind} at ${place} on ${formatDay(londonDate(report.occurred_at)).replace(/ \d{4}$/, '')}`;
}

export const HSE_WARNING_DAYS = 3;

export function dueReminders(reports, today = londonDate(new Date())) {
  const out = [];
  for (const r of reports) {
    if (r.status === 'closed') continue;
    const push = (key, message) => out.push({ report_id: r.id, key, message: `Accident book: ${message}` });
    const hse = riddorState(r, today);
    const ageDays = dayDiff(londonDate(r.created_at), today);

    if (hse.state === 'overdue') {
      push(`hse_overdue:${hse.due}`, `the HSE report for ${what(r)} is overdue - it was due ${formatDay(hse.due)}.`);
    } else if (hse.state === 'due') {
      if (!hse.due) push('hse_due', `report ${what(r)} to HSE now.`);
      else if (dayDiff(today, hse.due) <= HSE_WARNING_DAYS) push(`hse_due:${hse.due}`, `report ${what(r)} to HSE by ${formatDay(hse.due)}.`);
    } else if (hse.state === 'decide') {
      if (hse.due) push(`hse_decide_over7:${hse.due}`, `someone has now been off more than 7 days after ${what(r)}, so it needs reporting to HSE by ${formatDay(hse.due)}.`);
      else if (ageDays >= 1) push('hse_decide', `answer whether HSE needs to know about ${what(r)}.`);
    }

    if (ageDays >= 30) push('open_30', `${what(r)} has been open for a month. Finish the list and close it.`);
    else if (ageDays >= 7) push('open_7', `${what(r)} has been open for a week. Open it to see what's left to do.`);

    if (wasInjured(r) && isWorkerInjury(r) && r.off_work && !r.back_at_work_on) {
      const days = daysOffWork(r, today);
      if (days >= 7) {
        const week = Math.floor(days / 7);
        const who = injuredPersonName(r) || 'The injured person';
        push(`still_off:${week}`, `${who} has been off ${days} days since ${what(r)}. When they go back, note the date on the report.`);
      }
    }
  }
  return out;
}

// For tests and the route: the London date a week from a given one.
export const weekAfter = (day) => addDays(day, 7);
