// Accident and near-miss reports (0117). Labels, the checks the form makes
// before it sends, and the RIDDOR prompts the office sees.

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
      injury_details: injured ? text(form.injuryDetails) : null,
      treatment: injured ? treatment : null,
      damage_details: accident ? text(form.damageDetails) : null,
      immediate_action: text(form.immediateAction),
      witnesses: text(form.witnesses),
      photo_paths: form.photoPaths || [],
    },
  };
}

const DAY = 24 * 3600000;

// Prompts, not verdicts: whether something is RIDDOR reportable is the
// office's call, recorded in riddor_reportable. These say when it is worth
// checking, and what the deadline would be. Source: HSE's RIDDOR guidance
// (hse.gov.uk/riddor) - specified injuries to workers reported without
// delay, over-7-day incapacitation within 15 days of the accident, and a
// non-worker taken from the scene to hospital for treatment.
export function riddorPrompts(report) {
  if (report.kind !== 'accident' || !wasInjured(report)) return [];
  const prompts = [];
  const occurred = new Date(report.occurred_at);

  if (isWorkerInjury(report)) {
    if (report.treatment === 'hospital') {
      prompts.push({
        key: 'specified',
        text: 'Check whether this is a specified injury (a fracture other than to fingers, thumbs or toes, an amputation, a serious burn, loss of consciousness, a crush injury to the head or torso, and others) - those are reported to HSE straight away.',
      });
    }
    if (report.days_off_work > 7) {
      const due = new Date(occurred.getTime() + 15 * DAY);
      prompts.push({
        key: 'over7',
        text: `Off work for more than 7 days - reportable to HSE within 15 days of the accident (by ${due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}).`,
        due,
      });
    } else if (report.days_off_work > 3) {
      prompts.push({
        key: 'over3',
        text: 'Off work for more than 3 days - not reportable on its own, but this record must be kept. It becomes reportable if they are off for more than 7.',
      });
    }
  } else if (report.treatment === 'hospital') {
    prompts.push({
      key: 'public_hospital',
      text: 'Someone who is not a worker went to hospital. Reportable to HSE if they were taken there from the scene for treatment and the accident arose out of the work.',
    });
  }
  return prompts;
}

// Worth a flag on the list: the office has not yet said yes or no, and
// there is something to decide.
export function needsRiddorDecision(report) {
  return report.riddor_reportable === null && riddorPrompts(report).length > 0;
}

export function incidentSummary(report) {
  if (report.kind === 'near_miss') return 'Near miss - nobody hurt';
  if (report.injured_party === 'nobody') return 'Damage only - nobody hurt';
  const who = report.injured_party === 'me'
    ? 'Reporter hurt'
    : `${report.injured_name || INJURED_PARTY_LABELS[report.injured_party]} hurt`;
  return report.treatment ? `${who} - ${TREATMENT_LABELS[report.treatment].toLowerCase()}` : who;
}

export const CSV_COLUMNS = [
  { key: 'occurred', label: 'Date and time' },
  { key: 'kind', label: 'Type' },
  { key: 'reported_by', label: 'Reported by' },
  { key: 'reported', label: 'Reported at' },
  { key: 'location', label: 'Location' },
  { key: 'description', label: 'What happened' },
  { key: 'injured_party', label: 'Who was hurt' },
  { key: 'injured_name', label: 'Injured person' },
  { key: 'injury_details', label: 'Injury' },
  { key: 'treatment', label: 'Treatment' },
  { key: 'damage_details', label: 'Damage' },
  { key: 'immediate_action', label: 'Action taken at the time' },
  { key: 'witnesses', label: 'Witnesses' },
  { key: 'status', label: 'Status' },
  { key: 'severity', label: 'Severity' },
  { key: 'days_off_work', label: 'Days off work' },
  { key: 'riddor', label: 'RIDDOR reportable' },
  { key: 'riddor_reference', label: 'RIDDOR reference' },
  { key: 'root_cause', label: 'Cause' },
  { key: 'corrective_action', label: 'What we changed' },
];

function stamp(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

export function csvRow(report) {
  return {
    occurred: stamp(report.occurred_at),
    kind: KIND_LABELS[report.kind] || report.kind,
    reported_by: report.reporter?.full_name || '',
    reported: stamp(report.created_at),
    location: report.location,
    description: report.description,
    injured_party: report.injured_party ? INJURED_PARTY_LABELS[report.injured_party] : '',
    injured_name: report.injured_party === 'me' ? report.reporter?.full_name || '' : report.injured_name || '',
    injury_details: report.injury_details || '',
    treatment: report.treatment ? TREATMENT_LABELS[report.treatment] : '',
    damage_details: report.damage_details || '',
    immediate_action: report.immediate_action || '',
    witnesses: report.witnesses || '',
    status: STATUS_LABELS[report.status] || report.status,
    severity: report.severity ? SEVERITY_LABELS[report.severity] : '',
    days_off_work: report.days_off_work ?? '',
    riddor: report.riddor_reportable === null || report.riddor_reportable === undefined ? 'Not decided' : report.riddor_reportable ? 'Yes' : 'No',
    riddor_reference: report.riddor_reference || '',
    root_cause: report.root_cause || '',
    corrective_action: report.corrective_action || '',
  };
}
