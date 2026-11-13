// Accident, incident and near-miss reports (0117, 0130, 0131). Labels, the
// checks the form makes before it sends, the office's to-do list, and the
// yes/no questions that work out whether HSE needs to know (RIDDOR).
//
// Written for people who are not health and safety specialists: every
// label says what to do in plain words, and the RIDDOR category is worked
// out from answers rather than picked from a list of legal terms.

export const KIND_LABELS = { accident: 'Accident', incident: 'Incident', near_miss: 'Near miss' };

export const KIND_HELP = {
  accident: 'Someone was hurt.',
  incident: 'Something went wrong, but nobody was hurt - damage, a lost key, theft, a spill, someone being aggressive.',
  near_miss: 'Nothing happened this time, but someone could have been hurt.',
};

// What the staff buttons say: what happened, in their words.
export const KIND_BUTTONS = {
  accident: 'Someone got hurt',
  incident: 'Something went wrong',
  near_miss: 'It nearly happened',
};

export const INCIDENT_TYPE_LABELS = {
  damage: 'Something was damaged or broken',
  theft_or_loss: 'Something was lost or stolen',
  keys_or_access: 'Keys, codes or alarm problem',
  aggression: 'Someone was abusive, threatening or aggressive',
  security: 'Break-in, or a building left unlocked',
  spill_fire_flood: 'Chemical spill, fire, flood or gas leak',
  safeguarding: "Worried about someone's safety or welfare",
  other: 'Something else',
};

export const INJURED_PARTY_LABELS = {
  me: 'Me',
  colleague: 'A colleague',
  client: 'The client or someone at the client',
  public: 'A member of the public',
  // Older reports only (before 0131 made damage an incident).
  nobody: 'Nobody - something was damaged',
};
export const FORM_INJURED_PARTIES = ['me', 'colleague', 'client', 'public'];
// The office reporting for someone else: "a colleague" reads oddly there.
export const OFFICE_INJURED_PARTY_LABELS = { ...INJURED_PARTY_LABELS, colleague: 'A member of staff' };

export const TREATMENT_LABELS = {
  none: 'No treatment needed',
  first_aid: 'First aid on site',
  gp: 'GP, walk-in or minor injuries',
  hospital: 'Hospital or ambulance',
};

export const STATUS_LABELS = { open: 'New', investigating: 'In progress', closed: 'Closed' };
// The job-status badge colours, as Team Tasks does, rather than a new palette.
export const STATUS_BADGE_CLASS = { open: 'scheduled', investigating: 'in_progress', closed: 'completed' };

export const SEVERITY_LABELS = { low: 'Minor', medium: 'Moderate', high: 'Serious' };

export const INJURED_STATUS_LABELS = {
  employee: 'Yes - an employee',
  self_employed: 'Yes - self-employed or a subcontractor',
  non_worker: 'No - a client or member of the public',
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

// Stored in riddor_category. Plain wording for the CSV and the summary.
export const RIDDOR_CATEGORY_LABELS = {
  not_reportable: 'Not reportable to HSE',
  over_3_day_record_only: 'Over 3 days off - record kept, not reported',
  over_7_day: 'Over 7 days off - reportable',
  specified_injury: 'Serious (specified) injury - reportable',
  death: 'Death - reportable',
  non_worker_hospital: 'Non-worker taken to hospital - reportable',
  occupational_disease: 'Work-related illness - reportable',
  dangerous_occurrence: 'Dangerous occurrence - reportable',
};

const REPORTABLE = new Set(['over_7_day', 'specified_injury', 'death', 'non_worker_hospital', 'occupational_disease', 'dangerous_occurrence']);
export const isReportableCategory = (category) => REPORTABLE.has(category);

export const MAX_PHOTOS = 4;

export function wasInjured(report) {
  return report.kind === 'accident' && !!report.injured_party && report.injured_party !== 'nobody';
}

// RIDDOR treats people who work for us (employed or not) differently from
// anyone else hurt because of the work.
export function isWorkerInjury(report) {
  if (!wasInjured(report)) return false;
  if (report.injured_status) return report.injured_status !== 'non_worker';
  return report.injured_party === 'me' || report.injured_party === 'colleague';
}

// For <input type="datetime-local">, in the phone's own zone.
export function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Turns the form into a row, or says what is missing. The same rules as the
// table's check constraints, so a bad report is stopped with a sentence the
// person can act on rather than a Postgres error. office: an admin adding a
// report someone told them about, or copying an old paper one in.
export function buildIncidentRow(form, { reporterId, now = new Date(), office = false }) {
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const errors = [];

  if (!KIND_LABELS[form.kind]) errors.push('Choose what kind of report this is.');

  const occurred = form.occurredAt ? new Date(form.occurredAt) : null;
  if (!occurred || Number.isNaN(occurred.getTime())) errors.push('Say when it happened.');
  // A few minutes' grace for a phone clock that runs fast.
  else if (occurred.getTime() > now.getTime() + 5 * 60000) errors.push('The time it happened is in the future.');

  if (!text(form.location)) errors.push('Say where it happened.');
  if (!text(form.description)) errors.push('Say what happened.');

  const accident = form.kind === 'accident';
  const incident = form.kind === 'incident';
  let injuredParty = null;
  let treatment = null;
  let incidentType = null;
  if (accident) {
    injuredParty = FORM_INJURED_PARTIES.includes(form.injuredParty) ? form.injuredParty : null;
    if (!injuredParty) errors.push('Say who was hurt.');
    if (injuredParty) {
      treatment = TREATMENT_LABELS[form.treatment] ? form.treatment : null;
      if (!treatment) errors.push('Say what treatment they had.');
      if (!text(form.injuryDetails)) errors.push('Describe the injury.');
      if (injuredParty !== 'me' && !text(form.injuredName)) errors.push('Give the name of the person who was hurt.');
    }
  }
  if (incident) {
    incidentType = INCIDENT_TYPE_LABELS[form.incidentType] ? form.incidentType : null;
    if (!incidentType) errors.push('Say what kind of incident it was.');
  }

  if ((form.photoPaths || []).length > MAX_PHOTOS) errors.push(`Up to ${MAX_PHOTOS} photos.`);

  if (errors.length > 0) return { errors };

  return {
    errors: [],
    row: {
      reported_by: reporterId,
      kind: form.kind,
      incident_type: incidentType,
      told_by: office ? text(form.toldBy) : null,
      occurred_at: occurred.toISOString(),
      job_id: form.jobId || null,
      location: text(form.location),
      description: text(form.description),
      injured_party: injuredParty,
      injured_name: accident && injuredParty !== 'me' ? text(form.injuredName) : null,
      // Blank for "me" is fine: the database fills it from their staff record.
      injured_address: accident ? text(form.injuredAddress) : null,
      injured_occupation: accident ? text(form.injuredOccupation) : null,
      injury_details: accident ? text(form.injuryDetails) : null,
      treatment: accident ? treatment : null,
      damage_details: accident || incident ? text(form.damageDetails) : null,
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

// When HSE must have it, by category. "immediate" ones must be reported
// without delay; the 10 days is the latest the report can go.
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

// ---------------------------------------------------------------------------
// "Does HSE need to know?" - yes/no questions instead of legal categories.
// Source: HSE's RIDDOR guidance (hse.gov.uk/riddor).
// ---------------------------------------------------------------------------

export const SERIOUS_INJURIES = [
  'A broken bone (not fingers, thumbs or toes)',
  'An amputation',
  'Losing sight, or sight being damaged for good',
  'A crush injury to the head or body',
  'A serious burn (more than 10% of the body, or hurting the eyes, breathing or organs)',
  'Scalping that needs hospital treatment',
  'Knocked unconscious by a head injury or by lack of air',
  'In an enclosed space: hypothermia, heat illness, needing resuscitation, or more than 24 hours in hospital',
];

// The questions that apply to this report, in order.
export function hseQuestions(report) {
  if (wasInjured(report)) {
    if (isWorkerInjury(report)) {
      return [
        { key: 'died', text: 'Did they die as a result?' },
        { key: 'serious', text: 'Was it one of these serious injuries?', list: SERIOUS_INJURIES },
        { key: 'disease', text: 'Has a doctor said in writing that they have a work-related illness, such as dermatitis or asthma from cleaning products?', optional: true },
      ];
    }
    return [
      { key: 'died', text: 'Did they die as a result?' },
      { key: 'hospital', text: 'Were they taken straight from the scene to hospital for treatment? (Going only for checks, or as a precaution, does not count.)' },
    ];
  }
  if (report.kind === 'incident' || report.kind === 'near_miss') {
    return [{
      key: 'dangerous',
      text: 'Was it one of these "dangerous occurrences"?',
      list: [
        'An electrical short circuit or overload that caused a fire or explosion',
        'A gas leak, or a chemical released, that could have hurt people',
        'A lift, scaffold, ladder platform or other lifting equipment collapsing or failing',
      ],
      optional: true,
    }];
  }
  return [];
}

// Answers back out of a saved category, so a report opens with the
// questions as they were answered.
export function answersFromReport(report) {
  const no = 'no';
  switch (report.riddor_category) {
    case 'death': return { died: 'yes' };
    case 'specified_injury': return { died: no, serious: 'yes' };
    case 'non_worker_hospital': return { died: no, hospital: 'yes' };
    case 'occupational_disease': return { died: no, serious: no, disease: 'yes' };
    case 'dangerous_occurrence': return { dangerous: 'yes' };
    case 'not_reportable':
    case 'over_3_day_record_only':
    case 'over_7_day':
      return { died: no, serious: no, hospital: no, disease: no, dangerous: no };
    default: return {};
  }
}

// The category the answers add up to, or null while a needed question is
// unanswered. Time off is read from the report, not asked.
export function riddorFromAnswers(report, answers, today = londonDate(new Date())) {
  const yes = (k) => answers[k] === 'yes';
  const answered = (k) => answers[k] === 'yes' || answers[k] === 'no';

  if (wasInjured(report)) {
    if (yes('died')) return 'death';
    if (isWorkerInjury(report)) {
      if (yes('serious')) return 'specified_injury';
      if (yes('disease')) return 'occupational_disease';
      if (!answered('died') || !answered('serious')) return null;
      const days = daysOffWork(report, today);
      if (days > 7) return 'over_7_day';
      if (days > 3) return 'over_3_day_record_only';
      return 'not_reportable';
    }
    if (yes('hospital')) return 'non_worker_hospital';
    if (!answered('died') || !answered('hospital')) return null;
    return 'not_reportable';
  }
  if (yes('dangerous')) return 'dangerous_occurrence';
  return null;
}

// One plain sentence: what the answers mean for you.
export function hseOutcome(report) {
  const category = report.riddor_category;
  const accidentDay = londonDate(report.occurred_at);
  const deadline = riddorDeadline(report);
  if (!category) {
    return wasInjured(report)
      ? { tone: 'todo', text: 'Answer the questions above and this will tell you whether to report it.' }
      : null;
  }
  if (category === 'not_reportable') {
    const stillOff = report.off_work && !report.back_at_work_on;
    return {
      tone: 'ok',
      text: 'No, HSE does not need to know. It stays in your accident book.'
        + (stillOff && isWorkerInjury(report) ? ` If they are still off on ${formatDay(addDays(accidentDay, 8))}, it will need reporting.` : ''),
    };
  }
  if (category === 'over_3_day_record_only') {
    const stillOff = report.off_work && !report.back_at_work_on;
    return {
      tone: 'ok',
      text: 'Not yet. They have been off more than 3 days, so keep this record, but it is not reported.'
        + (stillOff ? ` If they are still off on ${formatDay(addDays(accidentDay, 8))}, report it by ${formatDay(addDays(accidentDay, 15))}.` : ''),
    };
  }
  if (report.riddor_reported_on) {
    return { tone: 'ok', text: `Reported to HSE on ${formatDay(report.riddor_reported_on)}${report.riddor_reference ? `, reference ${report.riddor_reference}` : ''}.` };
  }
  if (category === 'occupational_disease') {
    return { tone: 'urgent', text: 'Yes. Report it to HSE now that you have the diagnosis in writing.' };
  }
  const phone = category === 'death' || category === 'specified_injury'
    ? " Ring HSE's incident contact centre on 0345 300 9923, or report online, straight away."
    : '';
  return {
    tone: 'urgent',
    text: deadline?.immediate
      ? `Yes. Report it to HSE now, and by ${formatDay(deadline.due)} at the latest.${phone}`
      : `Yes. Report it to HSE by ${formatDay(deadline.due)}.`,
  };
}

// Extra things worth knowing, shown under the questions.
export function hseNotes(report) {
  const notes = [];
  if (wasInjured(report) && report.injured_status === 'self_employed') {
    notes.push("They are self-employed. If it happened in a client's building, it is usually the client (whoever controls the building) who reports it to HSE, not you. Tell the client and agree who will.");
  }
  if (report.accident_kind === 'harmful_substance' || report.incident_type === 'spill_fire_flood') {
    notes.push('If a doctor later says someone has dermatitis or asthma from the chemicals, that becomes reportable once it is in writing.');
  }
  return notes;
}

// Where the report stands with HSE, for the list badges and the counts.
//   overdue / due: it is reportable and has not gone yet
//   decide:        an injury nobody has answered the questions for, or the
//                  time off has since made it reportable
//   reported:      sent, with the date recorded
export function riddorState(report, today = londonDate(new Date())) {
  const category = report.riddor_category;
  if (isReportableCategory(category)) {
    if (report.riddor_reported_on) return { state: 'reported' };
    const deadline = riddorDeadline(report);
    const due = deadline?.due || null;
    return { state: due && due < today ? 'overdue' : 'due', due, immediate: !!deadline?.immediate };
  }
  if (!category) return { state: wasInjured(report) ? 'decide' : 'none' };
  // Answered "not reportable" or "record only", then the time off went past 7.
  if (isWorkerInjury(report) && daysOffWork(report, today) > 7) {
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
  if (report.injured_party !== 'me' && !report.injured_name) gaps.push('name');
  if (!report.injured_address) gaps.push('address');
  if (!report.injured_occupation) gaps.push('job');
  return gaps;
}

// The office's to-do list for one report. required: it cannot be closed
// until done. Each says what to do, not what the law is called.
export function todoList(report, today = londonDate(new Date())) {
  const items = [];
  const injured = wasInjured(report);
  if (injured) {
    const gaps = accidentBookGaps(report);
    items.push({
      key: 'book',
      label: gaps.length ? `Add the injured person's ${gaps.join(', ')} for the accident book` : 'Accident book details complete',
      done: gaps.length === 0,
      required: true,
    });
    items.push({ key: 'hse', label: 'Answer the questions about whether HSE needs to know', done: !!report.riddor_category && riddorState(report, today).state !== 'decide', required: true });
  }
  if (isReportableCategory(report.riddor_category)) {
    items.push({ key: 'hse_send', label: 'Report it to HSE, then note the date and their reference', done: !!(report.riddor_reported_on && report.riddor_reference?.trim()), required: true });
  }
  if (injured && report.off_work) {
    items.push({ key: 'back', label: 'Note the day they went back to normal work', done: !!report.back_at_work_on, required: true });
  }
  items.push({ key: 'fix', label: "Say what you've done so it doesn't happen again", done: !!report.corrective_action?.trim(), required: true });
  items.push({ key: 'cause', label: 'Note what caused it', done: !!report.root_cause?.trim(), required: false });
  items.push({ key: 'risk', label: 'Look again at the risk assessment for this job or task', done: !!report.risk_assessment_reviewed_on, required: false });
  // Only where the page knows the count (0135's site_hazards); the list view
  // and the close check do not need it.
  if (report.site_warning_count !== undefined) {
    items.push({ key: 'warn', label: 'Warn the next cleaner at the site, if the danger is still there', done: report.site_warning_count > 0, required: false });
  }
  if (report.kind === 'accident' || (report.kind === 'incident' && ['damage', 'theft_or_loss', 'aggression'].includes(report.incident_type))) {
    items.push({ key: 'insurer', label: 'Tell your insurer, if it could lead to a claim', done: !!report.insurer_notified_on, required: false });
  }
  if (report.job_id) {
    items.push({ key: 'client', label: 'Tell the client', done: !!report.client_notified_on, required: false });
  }
  return items;
}

// What stops a report being closed.
export function closeProblems(report, today) {
  return todoList(report, today).filter((i) => i.required && !i.done).map((i) => i.label);
}

export function injuredPersonName(report) {
  return report.injured_party === 'me' ? report.reporter?.full_name || '' : report.injured_name || '';
}

export function incidentSummary(report) {
  if (report.kind === 'near_miss') return 'Near miss - nobody hurt';
  if (report.kind === 'incident') return INCIDENT_TYPE_LABELS[report.incident_type] || 'Incident';
  if (report.injured_party === 'nobody') return 'Damage only - nobody hurt';
  const who = report.injured_party === 'me'
    ? `${report.reporter?.full_name || 'Reporter'} hurt`
    : `${report.injured_name || INJURED_PARTY_LABELS[report.injured_party]} hurt`;
  return report.treatment ? `${who} - ${TREATMENT_LABELS[report.treatment].toLowerCase()}` : who;
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
    report.kind === 'accident' ? `Kind of accident: ${ACCIDENT_KIND_LABELS[report.accident_kind] || 'Not set'}` : `Kind: ${INCIDENT_TYPE_LABELS[report.incident_type] || KIND_LABELS[report.kind]}`,
    `What happened: ${report.description}`,
  ];
  if (wasInjured(report)) {
    lines.push(
      '',
      'THE INJURED PERSON',
      `Name: ${injuredPersonName(report) || 'Not given'}`,
      `Address: ${report.injured_address || 'Not given'}`,
      `Occupation: ${report.injured_occupation || 'Not given'}`,
      `Works for us: ${INJURED_STATUS_LABELS[report.injured_status] || 'Not set'}`,
      '',
      'THE INJURY',
      `Injury: ${report.injury_details || ''}`,
      `Part of the body: ${report.body_part || 'Not set'}`,
      `Treatment: ${TREATMENT_LABELS[report.treatment] || ''}`,
      report.off_work
        ? `Time off: ${daysOffWork(report, today)} days${report.back_at_work_on ? `, back at work ${formatDay(report.back_at_work_on)}` : ', still off'}`
        : 'Time off: none recorded',
    );
  }
  return lines.filter((l) => l !== null).join('\n');
}

export const CSV_COLUMNS = [
  { key: 'occurred', label: 'Date and time' },
  { key: 'kind', label: 'Type' },
  { key: 'incident_type', label: 'Incident type' },
  { key: 'reported_by', label: 'Recorded by' },
  { key: 'told_by', label: 'Told by' },
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
  { key: 'injured_status', label: 'Works for us' },
  { key: 'injury_details', label: 'Injury' },
  { key: 'body_part', label: 'Part of body' },
  { key: 'treatment', label: 'Treatment' },
  { key: 'damage_details', label: 'Damage' },
  { key: 'immediate_action', label: 'Action taken at the time' },
  { key: 'witnesses', label: 'Witnesses' },
  { key: 'status', label: 'Status' },
  { key: 'severity', label: 'How serious' },
  { key: 'days_off_work', label: 'Days off work' },
  { key: 'back_at_work_on', label: 'Back at work' },
  { key: 'riddor', label: 'HSE (RIDDOR)' },
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
    incident_type: INCIDENT_TYPE_LABELS[report.incident_type] || '',
    reported_by: report.reporter?.full_name || '',
    told_by: report.told_by || '',
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
