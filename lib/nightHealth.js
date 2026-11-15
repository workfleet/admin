// Night worker health questionnaire (0143). Wording matches the Word form,
// "Night Worker Health Questionnaire.docx", so paper and app ask the same.

export const INTRO =
  'As a night worker you are entitled to a free health assessment before you start night work and at regular intervals after that (Working Time Regulations 1998). This questionnaire is the first step. It is voluntary and confidential: your answers are seen only by the person handling health assessments and are kept separately from your personnel file. If any answer suggests night work could affect your health, we will arrange for a qualified health professional to advise, at no cost to you.';

export const QUESTIONS_LEAD = 'Do you have, or are you being treated for…';

// key = the column in night_health_questionnaires.
export const QUESTIONS = [
  { key: 'diabetes', text: 'Diabetes, particularly if you take insulin?' },
  { key: 'heart_circulation', text: 'A heart or circulation condition, including high blood pressure?' },
  { key: 'breathing', text: 'A breathing condition, such as asthma or COPD?' },
  { key: 'digestive', text: 'Stomach or digestive problems, such as ulcers or IBS?' },
  { key: 'epilepsy', text: 'Epilepsy or seizures?' },
  { key: 'sleep', text: 'Difficulty sleeping, or a sleep condition such as sleep apnoea?' },
  { key: 'mental_health', text: 'Anxiety, depression or another mental health condition?' },
  { key: 'other_condition', text: 'Any other condition that you think night work could affect?' },
  { key: 'medication', text: 'Do you take medication that must be taken at set times, or that makes you drowsy?' },
  { key: 'pregnancy', text: 'Are you pregnant, or have you given birth in the last six months?' },
  { key: 'tired_unwell', text: 'Do you often feel very tired or unwell during or after night shifts?' },
  { key: 'other_job_caring', text: 'Do you have another job, or caring responsibilities, that affect your sleep?' },
];

export const DETAILS_PROMPT =
  'Use this space to tell us anything about your health or sleep that you think we should know, or any support that would help.';

export const CHOICES = [
  { value: true, text: 'I would like a health assessment and have completed this questionnaire.' },
  { value: false, text: 'I do not want a health assessment at the moment. I understand I can ask for one at any time.' },
];

export const OUTCOME_LABELS = {
  fit: 'Fit for night work',
  referred: 'Referred to a health professional',
  adjustments: 'Adjustments agreed',
};

export const RETENTION_NOTE =
  'Completed questionnaires are stored securely and separately from personnel files, and kept for as long as the person works nights and for two years after.';

export const COLUMNS = [
  'id', 'profile_id', 'role_and_site', 'shift_pattern',
  ...QUESTIONS.map((q) => q.key),
  'details', 'wants_assessment', 'signed_name', 'signed_on', 'submitted_at',
  'reviewed_by', 'reviewed_on', 'outcome', 'office_notes', 'next_review_due',
].join(', ');

export function emptyAnswers() {
  return Object.fromEntries(QUESTIONS.map((q) => [q.key, null]));
}

// What still stops the form being sent, in the order it appears.
export function formProblems(form) {
  const problems = [];
  const unanswered = QUESTIONS.filter((q) => typeof form.answers?.[q.key] !== 'boolean').length;
  if (unanswered > 0) problems.push(`answer Yes or No to ${unanswered === 1 ? 'one more question' : `${unanswered} more questions`}`);
  if (typeof form.wantsAssessment !== 'boolean') problems.push('choose whether you would like a health assessment');
  if ((form.signedName || '').trim().length < 2) problems.push('type your name to sign it');
  if (!form.confirmed) problems.push('tick the box to confirm your answers');
  return problems;
}

// The row to insert. Office fields and dates are set by the database.
export function rowFromForm(profileId, form) {
  const clean = (v) => {
    const t = (v || '').trim();
    return t ? t : null;
  };
  return {
    profile_id: profileId,
    role_and_site: clean(form.roleAndSite),
    shift_pattern: clean(form.shiftPattern),
    ...Object.fromEntries(QUESTIONS.map((q) => [q.key, form.answers[q.key]])),
    details: clean(form.details),
    wants_assessment: form.wantsAssessment,
    signed_name: form.signedName.trim(),
  };
}

export function yesAnswers(row) {
  return QUESTIONS.filter((q) => row[q.key] === true);
}

function parseDay(value) {
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dayString(date) {
  return date.toISOString().slice(0, 10);
}

// Twelve months on, the latest the next review can be (0143 checks it).
// 29 Feb rolls back to 28 Feb rather than forward into March.
export function latestReviewDate(reviewedOn) {
  const d = parseDay(reviewedOn);
  const next = new Date(Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate()));
  if (next.getUTCMonth() !== d.getUTCMonth()) next.setUTCDate(0);
  return dayString(next);
}

// Where someone stands, from their newest questionnaire (or none).
//   'none'      - never sent one
//   'waiting'   - sent, the office hasn't reviewed it yet
//   'due'       - reviewed, and the next review date has come
//   'done'      - reviewed, next review not due yet
export function standing(latest, today) {
  if (!latest) return 'none';
  if (!latest.outcome) return 'waiting';
  if (latest.next_review_due && latest.next_review_due <= today) return 'due';
  return 'done';
}

// Whether the office's request (0144) is still waiting for an answer: no
// questionnaire sent since it was sent.
export function requestOutstanding(requestedAt, latest) {
  if (!requestedAt) return false;
  return !latest || new Date(latest.submitted_at) < new Date(requestedAt);
}

// Whether to ask someone on their Home tab: a night worker who has none or
// is due a review, or anyone the office has sent it to who hasn't answered.
export function shouldPrompt(isNightWorker, latest, today, requestedAt = null) {
  if (requestOutstanding(requestedAt, latest)) return true;
  if (!isNightWorker) return false;
  const s = standing(latest, today);
  return s === 'none' || s === 'due';
}

// Newest questionnaire per person.
export function latestByPerson(rows) {
  const out = {};
  for (const row of rows || []) {
    const prev = out[row.profile_id];
    if (!prev || row.submitted_at > prev.submitted_at) out[row.profile_id] = row;
  }
  return out;
}

export function formatDay(value) {
  if (!value) return '';
  return parseDay(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
