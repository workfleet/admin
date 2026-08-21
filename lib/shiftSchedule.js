// Shift patterns for contract quotes.
//
// The room-benchmark calculator in quoteCalculator.js prices a *visit* -
// it works backwards from hours to a price that clears a target margin.
// A staffed contract is sold the other way round: the client agrees a
// standing pattern of shifts ("2:00am-5:00am, Mon/Wed/Thu/Fri/Sat") at
// an agreed rate per hour, and the weekly charge falls out of that. This
// module owns that second model - hours in, money out, no margin logic.
//
// Stored on quotes.shift_schedule as:
//   {
//     siteAddress,                       // the site being quoted for
//     initialWeeks: { min, max },        // proposed initial contract period
//     patterns: [{
//       id, label, days: ['mon', ...], start: 'HH:MM', end: 'HH:MM',
//       operatives, rate, recurrence: 'weekly' | 'occasional',
//       occasionLabel, note,
//     }]
//   }

export const WEEKDAYS = [
  { key: 'mon', label: 'Monday', short: 'Mon' },
  { key: 'tue', label: 'Tuesday', short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday', short: 'Thu' },
  { key: 'fri', label: 'Friday', short: 'Fri' },
  { key: 'sat', label: 'Saturday', short: 'Sat' },
  { key: 'sun', label: 'Sunday', short: 'Sun' },
];

export const RECURRENCE_OPTIONS = [
  { value: 'weekly', label: 'Every week' },
  { value: 'occasional', label: 'Ad-hoc (charged per occurrence)' },
];

export const EMPTY_SHIFT_PATTERN = {
  label: '',
  days: [],
  start: '09:00',
  end: '17:00',
  operatives: 1,
  rate: '',
  recurrence: 'weekly',
  occasionLabel: 'bank holiday',
  note: '',
};

export const EMPTY_SHIFT_SCHEDULE = {
  siteAddress: '',
  initialWeeks: { min: 4, max: 6 },
  patterns: [],
};

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function minutesOfDay(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

// An end time at or before the start means the shift runs through
// midnight - a 10:00pm-2:00am shift is four hours, not minus twenty.
export function shiftHours(start, end) {
  const from = minutesOfDay(start);
  const to = minutesOfDay(end);
  if (from === null || to === null) return 0;
  const span = to > from ? to - from : to + 24 * 60 - from;
  return round2(span / 60);
}

export function formatTime(time) {
  const total = minutesOfDay(time);
  if (total === null) return '';
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

export function formatTimeRange(start, end) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function dayLabels(days) {
  const order = WEEKDAYS.map((d) => d.key);
  return [...(days || [])]
    .filter((d) => order.includes(d))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((d) => WEEKDAYS.find((w) => w.key === d));
}

// "Monday to Friday" reads better than five bullets, but only when the
// days really are a consecutive run - Mon/Wed/Thu/Fri/Sat has to stay a
// list, or the document promises a Tuesday nobody is attending.
export function describeDays(days) {
  const picked = dayLabels(days);
  if (picked.length === 0) return '';
  if (picked.length === 1) return picked[0].label;

  const order = WEEKDAYS.map((d) => d.key);
  const indexes = picked.map((d) => order.indexOf(d.key));
  const consecutive = indexes.every((n, i) => i === 0 || n === indexes[i - 1] + 1);

  if (consecutive && picked.length >= 3) {
    return `${picked[0].label} to ${picked[picked.length - 1].label}`;
  }
  return picked.map((d) => d.label).join(', ');
}

export function isPatternComplete(pattern) {
  if (!pattern) return false;
  if (shiftHours(pattern.start, pattern.end) <= 0) return false;
  if (!(Number(pattern.rate) > 0)) return false;
  if (!(Number(pattern.operatives) > 0)) return false;
  if (pattern.recurrence === 'occasional') return true;
  return (pattern.days || []).length > 0;
}

function summarisePattern(pattern) {
  const hoursPerShift = shiftHours(pattern.start, pattern.end);
  const operatives = Number(pattern.operatives) || 1;
  const rate = Number(pattern.rate) || 0;
  const occasional = pattern.recurrence === 'occasional';
  const shiftsPerWeek = occasional ? 0 : (pattern.days || []).length;

  const hoursPerOccasion = round2(hoursPerShift * operatives);
  const hoursPerWeek = round2(hoursPerOccasion * shiftsPerWeek);

  return {
    ...pattern,
    occasional,
    hoursPerShift,
    operatives,
    rate,
    shiftsPerWeek,
    hoursPerOccasion,
    hoursPerWeek,
    chargePerOccasion: round2(hoursPerOccasion * rate),
    weeklyCharge: round2(hoursPerWeek * rate),
    daysDescription: describeDays(pattern.days),
    timeRange: formatTimeRange(pattern.start, pattern.end),
  };
}

// Returns null when there's nothing usable to show, so callers can treat
// "no schedule" and "a schedule that was started but never filled in"
// the same way rather than rendering a section full of zeroes.
export function summariseShiftSchedule(schedule) {
  const patterns = (schedule?.patterns || []).filter(isPatternComplete).map(summarisePattern);
  if (patterns.length === 0) return null;

  const weekly = patterns.filter((p) => !p.occasional);
  const occasional = patterns.filter((p) => p.occasional);

  const weeklyHours = round2(weekly.reduce((sum, p) => sum + p.hoursPerWeek, 0));
  const weeklyCharge = round2(weekly.reduce((sum, p) => sum + p.weeklyCharge, 0));

  const min = Number(schedule?.initialWeeks?.min) || 0;
  const max = Number(schedule?.initialWeeks?.max) || 0;
  const weekCounts = [...new Set([min, max].filter((n) => n > 0))].sort((a, b) => a - b);

  return {
    patterns,
    weekly,
    occasional,
    weeklyHours,
    weeklyCharge,
    monthlyCharge: round2(weeklyCharge * (52 / 12)),
    initialWeeks: { min, max },
    contractValues: weekCounts.map((weeks) => ({ weeks, value: round2(weeklyCharge * weeks) })),
  };
}

// Suggested wording for the quote's description field - a starting point
// the admin is expected to edit, same as defaultQuoteDescription.
export function shiftScheduleDescription(summary, address) {
  if (!summary) return '';
  const where = address ? ` at ${address}` : '';
  const shifts = summary.weekly
    .map((p) => `${(p.label || 'cleaning').toLowerCase()} ${p.timeRange.toLowerCase()}, ${p.daysDescription.toLowerCase()}`)
    .join('; ');

  return `CrewConnect Cleaning will provide a staffed cleaning service${where}, `
    + `covering ${summary.weeklyHours} hours per week: ${shifts}.`;
}
