// Accident and near-miss reports (0130). Labels, the checks the form makes
// before it sends, and the RIDDOR prompts, deadlines and HSE summary the
// office sees.

export const KIND_LABELS = { accident: 'Accident', near_miss: 'Near miss' };

export const INJURED_PARTY_LABELS = {
  me: 'Me',
  colleague: 'A colleague',
  client: 'The client or someone at the client',
  public: 'A member of the public',
  nobody: 'Nobody - something was damaged',
};

export const TREATMENT_LABELS = {
  none: 'No treatment needed',
  first_aid: 'First aid on site',
  gp: 'GP, walk-in or minor injuries',
  hospital: 'Hospital or ambulance',
};

export const STATUS_LABELS = { open: 'Open', investigating: 'Investigating', closed: 'Closed' };
// The job-status badge colours, as Team Tasks does, rather than a new palette.
export const STATUS_BADGE_CLASS = { open: 'scheduled', investigating: 'in_progress', closed: 'completed' };

export const SEVERITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' };

export const INJURED_STATUS_LABELS = {
  employee: 'Employee',
  self_employed: 'Self-employed (subcontractor)',
  non_worker: 'Not a worker (client or public)',
};

// HSE's "kind of accident" list, worded as on the online report form.
export const ACCIDENT_KIND_LABELS = {
  slip_trip_same_level: 'Slipped, tripped or fell on the same level',
  handling_lifting: 'Injured while handling, lifting or carrying',
  fall_from_height: 'Fell from a height',
  harmful_substance: 'Exposed to, or in contact with, a harmful substance',
  struck_by_object: 'Hit by a moving, flying or falling object',
  hit_fixed_object: 'Hit something fixed or stationary',
  electricity: 'Contact with electricity or an electrical discharge',
  machinery: 'Contact with moving machinery',
  struck_by_vehicle: 'Hit by a moving vehicle',
  trapped_collapse: 'Trapped by something collapsing or overturning',
  drowned_asphyxiated: 'Drowned or asphyxiated',
  fire: 'Exposed to fire',
  explosion: 'Exposed to an explosion',
  animal: 'Injured by an animal',
  assault: 'Physically assaulted by a person',
  other: 'Another kind of accident',
};

export const RIDDOR_CATEGORY_LABELS = {
  not_reportable: 'Not reportable',
  over_3_day_record_only: 'Over 3 days off - record only, not reported',
  over_7_day: 'Over 7 days off - report within 15 days',
  specified_injury: 'Specified injury - report now',
  death: 'Death - report now',
  non_worker_hospital: 'Non-worker taken to hospital - report now',
  occupational_disease: 'Occupational disease - report on diagnosis',
  dangerous_occurrence: 'Dangerous occurrence - report now',
};

const REPORTABLE = new Set(['over_7_day', 'specified_injury', 'death', 'non_worker_hospital', 'occupational_disease', 'dangerous_occurrence']);
export const isReportableCategory = (category) => REPORTABLE.has(category);

export const MAX_PHOTOS = 4;

// Workers are "me" and "a colleague"; RIDDOR treats them differently from
// anyone else hurt because of the work.
export function isWorkerInjury(report) {
  return report.kind === 'accident' && (report.injured_party === 'me' || report.injured_party === 'colleague');
}

export function wasInjured(report) {
  return report.kind === 'accident' && !!report.injured_party && report.injured_party !== 'nobody';
}

// For <input type="datetime-local">, in the phone's own zone.
export function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Turns the form into a row, or says what is missing. The same rules as the
// table's check constraint, so a bad report is stopped with a sentence the
// cleaner can act on rather than a Postgres error.
export function buildIncidentRow(form, { reporterId, now = new Date() }) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const errors = [];

  if (form.kind !== 'accident' && form.kind !== 'near_miss') errors.push('Choose accident or near miss.');

  const occurred = form.occurredAt ? new Date(form.occurredAt) : null;
  if (!occurred || Number.isNaN(occurred.getTime())) errors.push('Say when it happened.');
  // A few minutes' grace for a phone clock that runs fast.
  else if (occurred.getTime() > now.getTime() + 5 * 60000) errors.push('The time it happened is in the future.');

  if (!text(form.location)) errors.push('Say where it happened.');
  if (!text(form.description)) errors.push('Say what happened.');

  const accident = form.kind === 'accident';
  let injuredParty = null;
  let treatment = null;
  if (accident) {
    injuredParty = INJURED_PARTY_LABELS[form.injuredParty] ? form.injuredParty : null;
    if (!injuredParty) errors.push('Say who was hurt, or that nobody was.');
    if (injuredParty && injuredParty !== 'nobody') {
      treatment = TREATMENT_LABELS[form.treatment] ? form.treatment : null;
      if (!treatment) errors.push('Say what treatment they had.');
      if (!text(form.injuryDetails)) errors.push('Describe the injury.');
      if (injuredParty !== 'me' && !text(form.injuredName)) errors.push('Give the name of the person who was hurt.');
    }
    if (injuredParty === 'nobody' && !text(form.damageDetails)) errors.push('Say what was damaged.');
  }

  if ((form.photoPaths || []).length > MAX_PHOTOS) errors.push(`Up to ${MAX_PHOTOS} photos.`);

  if (errors.length > 0) return { errors };

  const injured = accident && injuredParty !== 'nobody';
  return {
    errors: [],
    row: {
      reported_by: reporterId,
      kind: form.kind,
      occurred_at: occurred.toISOString(),
      job_id: form.jobId || null,
      location: text(form.location),
      description: text(form.description),
      injured_party: injuredParty,
      injured_name: injured && injuredParty !== 'me' ? text(form.injuredName) : null,
      // Blank for "me" is fine: the database fills it from their staff record.
      injured_address: injured ? text(form.injuredAddress) : null,
      injured_occupation: injured ? text(form.injuredOccupation) : null,
      injury_details: injured ? text(form.injuryDetails) : null,
      treatment: injured ? treatment : null,
      damage_details: accident ? text(form.damageDetails) : null,
      immediate_action: text(form.immediateAction),
      witnesses: text(form.witnesses),
      photo_paths: form.photoPaths || [],
    },
  };
}

// ---------------------------------------------------------------------------
// Dates. RIDDOR counts in calendar days in the UK, so everything here is a
// London date string (YYYY-MM-DD), whatever zone the browser or test is in.
// ---------------------------------------------------------------------------

const londonDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
export function londonDate(value) {
  return londonDay.format(new Date(value));
}

function dayNumber(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function addDays(dateString, days) {
  return new Date((dayNumber(dateString) + days) * 86400000).toISOString().slice(0, 10);
}

export function formatDay(dateString) {
  if (!dateString) return '';
  return new Date(`${dateString}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// Days off work (or unable to do their normal job) as RIDDOR counts them:
// not the day of the accident, weekends and rest days included. Back on day
// B means off up to B - 1; still off means off up to and including today.
export function daysOffWork(report, today = londonDate(new Date())) {
  if (!report.off_work) return 0;
  const accidentDay = dayNumber(londonDate(report.occurred_at));
  const days = report.back_at_work_on
    ? dayNumber(report.back_at_work_on) - accidentDay - 1
    : dayNumber(today) - accidentDay;
  return Math.max(0, days);
}

// When HSE must have it, by category. "now" categories must also be
// reported without delay (a phone call for a death or specified injury);
// the 10 days is the latest the written report can go.
export function riddorDeadline(report) {
  const day = londonDate(report.occurred_at);
  switch (report.riddor_category) {
    case 'death':
    case 'specified_injury':
    case 'non_worker_hospital':
    case 'dangerous_occurrence':
      return { immediate: true, due: addDays(day, 10) };
    case 'over_7_day':
      return { immediate: false, due: addDays(day, 15) };
    case 'occupational_disease':
      return { immediate: true, due: null };
    default:
      return null;
  }
}

// Prompts, not verdicts: which category it falls in is the office's call,
// recorded in riddor_category. These say when it is worth checking, and
// what the deadline would be. Source: HSE's RIDDOR guidance
// (hse.gov.uk/riddor).
export function riddorPrompts(report, today = londonDate(new Date())) {
  if (report.kind !== 'accident' || !wasInjured(report)) return [];
  const prompts = [];
  const accidentDay = londonDate(report.occurred_at);
  const days = daysOffWork(report, today);
  const selfEmployed = report.injured_status === 'self_employed';
  const worker = isWorkerInjury(report) && report.injured_status !== 'non_worker';

  if (worker) {
    if (report.treatment === 'hospital') {
      prompts.push({
        key: 'specified',
        text: 'Check whether this is a specified injury: a fracture other than to fingers, thumbs or toes; an amputation; permanent loss or reduction of sight; a crush injury to the head or torso; serious burns (over 10% of the body, or damaging the eyes, breathing or vital organs); a scalping needing hospital treatment; loss of consciousness from a head injury or asphyxia; or work in an enclosed space leading to hypothermia, heat illness, resuscitation or more than 24 hours in hospital. Those are reported straight away.',
      });
    }
    if (days > 7) {
      const due = addDays(accidentDay, 15);
      prompts.push({
        key: 'over7',
        text: `Off work, or unable to do their normal job, for ${days} days - more than 7, so reportable to HSE within 15 days of the accident (by ${formatDay(due)}).`,
        due,
      });
    } else if (report.off_work) {
      const reportableFrom = addDays(accidentDay, 8);
      const stillOff = !report.back_at_work_on;
      prompts.push({
        key: days > 3 ? 'over3' : 'off',
        text: (days > 3
          ? `Off for ${days} days - more than 3, so this record must be kept, but it is not reported on its own.`
          : `Off for ${days} day${days === 1 ? '' : 's'} so far.`)
          + (stillOff ? ` If they are still off on ${formatDay(reportableFrom)}, it becomes reportable, by ${formatDay(addDays(accidentDay, 15))}.` : ''),
      });
    }
    if (selfEmployed) {
      prompts.push({
        key: 'self_employed',
        text: 'They are self-employed. If it happened on premises someone else controls (a client\'s building), it is usually that person who reports it to HSE, not us - tell the client and check who will. On our own premises it is ours to report.',
      });
    }
  } else if (report.treatment === 'hospital') {
    prompts.push({
      key: 'public_hospital',
      text: 'Someone who is not a worker went to hospital. Reportable to HSE if they were taken there directly from the scene for treatment and the accident arose out of our work. Taken only for checks, or as a precaution, is not reportable.',
    });
  }

  if (report.accident_kind === 'harmful_substance') {
    prompts.push({
      key: 'disease',
      text: 'If a doctor later diagnoses dermatitis, occupational asthma or another work-related disease from the chemicals, that is reportable as an occupational disease once we get the diagnosis in writing.',
    });
  }
  return prompts;
}

// Where the report stands with HSE, for the list badges and tiles.
//   overdue / due: the office said it is reportable and it has not gone yet
//   decide:        nobody has decided, or the time off has since made it
//                  reportable
//   reported:      sent, with the date recorded
export function riddorState(report, today = londonDate(new Date())) {
  const category = report.riddor_category;
  if (isReportableCategory(category)) {
    if (report.riddor_reported_on) return { state: 'reported' };
    const deadline = riddorDeadline(report);
    const due = deadline?.due || null;
    return { state: due && due < today ? 'overdue' : 'due', due, immediate: !!deadline?.immediate };
  }
  // Every injury gets a category, "Not reportable" included, before it can
  // be closed - so an undecided one is always worth a flag.
  if (!category) return { state: wasInjured(report) ? 'decide' : 'none' };
  // Decided "not reportable" or "record only", then the time off went past 7.
  if (isWorkerInjury(report) && report.injured_status !== 'non_worker' && daysOffWork(report, today) > 7) {
    return { state: 'decide', due: addDays(londonDate(report.occurred_at), 15) };
  }
  return { state: 'none' };
}

export function needsRiddorDecision(report, today) {
  return riddorState(report, today).state === 'decide';
}

// The accident book entry is only complete with these (reg 25). The
// reporter's own details are filled in by the database; the injured
// person's may need the office to finish them.
export function accidentBookGaps(report) {
  if (!wasInjured(report)) return [];
  const gaps = [];
  if (report.injured_party !== 'me' && !report.injured_name) gaps.push('the injured person\'s name');
  if (!report.injured_address) gaps.push('the injured person\'s address');
  if (!report.injured_occupation) gaps.push('the injured person\'s occupation');
  return gaps;
}

// What stops a report being closed. Each is something the law or the
// insurer will ask for.
export function closeProblems(report) {
  const problems = [];
  if (!report.corrective_action?.trim()) problems.push('Say what was done or changed.');
  if (report.kind === 'accident' && wasInjured(report)) {
    const gaps = accidentBookGaps(report);
    if (gaps.length) problems.push(`Fill in ${gaps.join(', ')} for the accident book (type "Not given" if they would not say).`);
    if (!report.riddor_category) problems.push('Choose a RIDDOR category, even if it is "Not reportable".');
    if (isReportableCategory(report.riddor_category) && (!report.riddor_reported_on || !report.riddor_reference?.trim())) {
      problems.push('Record the date it went to HSE and the reference HSE gave.');
    }
    if (report.off_work && !report.back_at_work_on) problems.push('Record the day they went back to work, or leave it open until they do.');
  }
  return problems;
}

export function incidentSummary(report) {
  if (report.kind === 'near_miss') return 'Near miss - nobody hurt';
  if (report.injured_party === 'nobody') return 'Damage only - nobody hurt';
  const who = report.injured_party === 'me'
    ? 'Reporter hurt'
    : `${report.injured_name || INJURED_PARTY_LABELS[report.injured_party]} hurt`;
  return report.treatment ? `${who} - ${TREATMENT_LABELS[report.treatment].toLowerCase()}` : who;
}

export function injuredPersonName(report) {
  return report.injured_party === 'me' ? report.reporter?.full_name || '' : report.injured_name || '';
}

// Laid out in the order HSE's online form asks, to copy across field by
// field. HSE has no API: someone still makes the report on hse.gov.uk.
export function hseSummary(report, company, today = londonDate(new Date())) {
  const when = new Date(report.occurred_at);
  const lines = [
    'ABOUT US',
    `Organisation: ${company.legalName || company.name}`,
    company.registeredOffice ? `Address: ${company.registeredOffice}` : null,
    company.phone ? `Phone: ${company.phone}` : null,
    company.email ? `Email: ${company.email}` : null,
    'Type of business: Commercial and domestic cleaning',
    '',
    'ABOUT THE INCIDENT',
    `Category: ${RIDDOR_CATEGORY_LABELS[report.riddor_category] || 'Not decided'}`,
    `Date: ${when.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/London' })}`,
    `Time: ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}`,
    `Where: ${report.location}${report.jobs?.properties?.address && report.jobs.properties.address !== report.location ? ` (${report.jobs.properties.address})` : ''}`,
    `Kind of accident: ${ACCIDENT_KIND_LABELS[report.accident_kind] || 'Not set'}`,
    `What happened: ${report.description}`,
    '',
    'THE INJURED PERSON',
    `Name: ${injuredPersonName(report) || 'Not given'}`,
    `Address: ${report.injured_address || 'Not given'}`,
    `Occupation: ${report.injured_occupation || 'Not given'}`,
    `Status: ${INJURED_STATUS_LABELS[report.injured_status] || 'Not set'}`,
    '',
    'THE INJURY',
    `Injury: ${report.injury_details || ''}`,
    `Part of the body: ${report.body_part || 'Not set'}`,
    `Treatment: ${TREATMENT_LABELS[report.treatment] || ''}`,
    report.off_work
      ? `Time off: ${daysOffWork(report, today)} days${report.back_at_work_on ? `, back at work ${formatDay(report.back_at_work_on)}` : ', still off'}`
      : 'Time off: none recorded',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export const CSV_COLUMNS = [
  { key: 'occurred', label: 'Date and time' },
  { key: 'kind', label: 'Type' },
  { key: 'reported_by', label: 'Recorded by' },
  { key: 'recorded_by_address', label: 'Recorder address' },
  { key: 'recorded_by_occupation', label: 'Recorder occupation' },
  { key: 'reported', label: 'Recorded at' },
  { key: 'location', label: 'Location' },
  { key: 'description', label: 'What happened' },
  { key: 'accident_kind', label: 'Kind of accident' },
  { key: 'injured_party', label: 'Who was hurt' },
  { key: 'injured_name', label: 'Injured person' },
  { key: 'injured_address', label: 'Injured person address' },
  { key: 'injured_occupation', label: 'Injured person occupation' },
  { key: 'injured_status', label: 'Employment status' },
  { key: 'injury_details', label: 'Injury' },
  { key: 'body_part', label: 'Part of body' },
  { key: 'treatment', label: 'Treatment' },
  { key: 'damage_details', label: 'Damage' },
  { key: 'immediate_action', label: 'Action taken at the time' },
  { key: 'witnesses', label: 'Witnesses' },
  { key: 'status', label: 'Status' },
  { key: 'severity', label: 'Severity' },
  { key: 'days_off_work', label: 'Days off work' },
  { key: 'back_at_work_on', label: 'Back at work' },
  { key: 'riddor', label: 'RIDDOR category' },
  { key: 'riddor_reported_on', label: 'Reported to HSE on' },
  { key: 'riddor_reference', label: 'HSE reference' },
  { key: 'insurer_notified_on', label: 'Insurer told on' },
  { key: 'client_notified_on', label: 'Client told on' },
  { key: 'risk_assessment_reviewed_on', label: 'Risk assessment reviewed on' },
  { key: 'root_cause', label: 'Cause' },
  { key: 'corrective_action', label: 'What we changed' },
];

function stamp(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/London' });
}

const day = (value) => (value ? formatDay(value) : '');

export function csvRow(report, today) {
  return {
    occurred: stamp(report.occurred_at),
    kind: KIND_LABELS[report.kind] || report.kind,
    reported_by: report.reporter?.full_name || '',
    recorded_by_address: report.recorded_by_address || '',
    recorded_by_occupation: report.recorded_by_occupation || '',
    reported: stamp(report.created_at),
    location: report.location,
    description: report.description,
    accident_kind: ACCIDENT_KIND_LABELS[report.accident_kind] || '',
    injured_party: report.injured_party ? INJURED_PARTY_LABELS[report.injured_party] : '',
    injured_name: injuredPersonName(report),
    injured_address: report.injured_address || '',
    injured_occupation: report.injured_occupation || '',
    injured_status: INJURED_STATUS_LABELS[report.injured_status] || '',
    injury_details: report.injury_details || '',
    body_part: report.body_part || '',
    treatment: report.treatment ? TREATMENT_LABELS[report.treatment] : '',
    damage_details: report.damage_details || '',
    immediate_action: report.immediate_action || '',
    witnesses: report.witnesses || '',
    status: STATUS_LABELS[report.status] || report.status,
    severity: report.severity ? SEVERITY_LABELS[report.severity] : '',
    days_off_work: report.off_work ? daysOffWork(report, today) : '',
    back_at_work_on: day(report.back_at_work_on),
    riddor: RIDDOR_CATEGORY_LABELS[report.riddor_category] || (wasInjured(report) ? 'Not decided' : ''),
    riddor_reported_on: day(report.riddor_reported_on),
    riddor_reference: report.riddor_reference || '',
    insurer_notified_on: day(report.insurer_notified_on),
    client_notified_on: day(report.client_notified_on),
    risk_assessment_reviewed_on: day(report.risk_assessment_reviewed_on),
    root_cause: report.root_cause || '',
    corrective_action: report.corrective_action || '',
  };
}
