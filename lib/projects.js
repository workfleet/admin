// Projects: kinds, statuses, starter templates and the small sums the
// Projects pages show (progress, what's next, what's late).
//
// Dates here are 'YYYY-MM-DD' strings, the shape Postgres `date` columns and
// <input type="date"> use. Day arithmetic is done in UTC so a clock change
// can never move a date by one (see lib/localDate.js for why that matters).

export const PROJECT_KINDS = [
  { value: 'tender', label: 'Tender or bid' },
  { value: 'contract_start', label: 'New contract start-up' },
  { value: 'deep_clean', label: 'Deep clean' },
  { value: 'certification', label: 'Certification (e.g. ISO)' },
  { value: 'internal', label: 'Internal' },
  { value: 'other', label: 'Other' },
];

export const PROJECT_STATUSES = [
  { value: 'planning', label: 'Planning' },
  { value: 'active', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const TASK_STATUSES = [
  { value: 'to_do', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

export const TENDER_OUTCOMES = [
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

export function kindLabel(kind) {
  return PROJECT_KINDS.find((k) => k.value === kind)?.label || 'Other';
}

export function statusLabel(status) {
  return PROJECT_STATUSES.find((s) => s.value === status)?.label || status;
}

// Open = still being worked on, as opposed to finished or dropped.
export function isOpenStatus(status) {
  return status === 'planning' || status === 'active' || status === 'on_hold';
}

// Starter tasks and key dates per kind. `days` is relative to the project's
// target date (negative = before it). Without a target date nothing gets a
// due date, and the office fills them in. Every template is only a start:
// tasks can be renamed, removed or added once the project exists.
export const PROJECT_TEMPLATES = {
  tender: {
    targetLabel: 'Submission deadline',
    fileFolders: ['Tender pack', 'Our submission', 'Pricing', 'Correspondence'],
    dates: [
      { label: 'Clarification questions close', days: -7 },
      { label: 'Submission deadline', days: 0 },
    ],
    tasks: [
      { title: 'Read the tender pack and list every document it asks for', days: -21 },
      { title: 'Check the pass/fail requirements (certificates, insurance, turnover)', days: -20 },
      { title: 'Site visit', days: -18 },
      { title: 'Build the pricing model', days: -14 },
      { title: 'Write the quality answers', days: -10 },
      { title: 'Fill in the questionnaire (PSQ / SQ)', days: -9 },
      { title: 'Gather certificates, insurance and policies', days: -9 },
      { title: 'Send any clarification questions', days: -8 },
      { title: 'Declarations and signatures', days: -4 },
      { title: 'Final check against the list of required documents', days: -2 },
      { title: 'Submit and save the confirmation', days: -1 },
    ],
  },
  contract_start: {
    targetLabel: 'Contract start date',
    fileFolders: ['Site info', 'Staff & training', 'Client paperwork'],
    dates: [{ label: 'Contract starts', days: 0 }],
    tasks: [
      { title: 'Site survey and risk assessment', days: -21 },
      { title: 'Agree the specification, frequencies and access', days: -20 },
      { title: 'Recruit or assign cleaners', days: -14 },
      { title: 'Order stock and equipment', days: -10 },
      { title: 'Collect keys, fobs and door codes', days: -7 },
      { title: 'Set up the site checklist in the app', days: -7 },
      { title: 'Add the recurring jobs to the rota', days: -5 },
      { title: 'Site induction for the cleaners', days: -2 },
      { title: 'First-week check-in with the client', days: 7 },
    ],
  },
  deep_clean: {
    targetLabel: 'Deep clean date',
    fileFolders: ['Before photos', 'After photos', 'Paperwork'],
    dates: [{ label: 'Deep clean day', days: 0 }],
    tasks: [
      { title: 'Site visit and scope of works', days: -14 },
      { title: 'Agree the price with the client', days: -12 },
      { title: 'Risk assessment and method statement', days: -7 },
      { title: 'Book any equipment hire (e.g. MEWP)', days: -7 },
      { title: 'Order products and PPE', days: -5 },
      { title: 'Assign the team', days: -5 },
      { title: 'Before photos', days: 0 },
      { title: 'After photos and client sign-off', days: 0 },
      { title: 'Invoice', days: 2 },
    ],
  },
  certification: {
    targetLabel: 'Certification audit date',
    fileFolders: ['Evidence', 'Policies & procedures', 'Audit reports'],
    dates: [{ label: 'Certification audit', days: 0 }],
    tasks: [
      { title: 'Get quotes from certification bodies', days: -120 },
      { title: 'Gap analysis against the standard', days: -105 },
      { title: 'Write or update the policies and procedures', days: -75 },
      { title: 'Train staff on the new procedures', days: -45 },
      { title: 'Internal audit', days: -30 },
      { title: 'Management review', days: -21 },
      { title: 'Stage 1 audit', days: -14 },
      { title: 'Fix anything Stage 1 finds', days: -7 },
      { title: 'Stage 2 audit', days: 0 },
    ],
  },
  internal: { targetLabel: 'Target date', dates: [], tasks: [] },
  other: { targetLabel: 'Target date', dates: [], tasks: [] },
};

export function templateFor(kind) {
  return PROJECT_TEMPLATES[kind] || PROJECT_TEMPLATES.other;
}

// 'YYYY-MM-DD' + n days, or null when there is no date to count from.
export function addDays(dateString, days) {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const [y, m, d] = dateString.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// The rows a new project starts with, ready to insert once it has an id.
export function buildFromTemplate(kind, targetDate) {
  const template = templateFor(kind);
  return {
    tasks: template.tasks.map((t, i) => ({
      title: t.title,
      due_date: addDays(targetDate, t.days),
      position: i,
    })),
    // A key date with no target date to hang it on has nothing to say, so
    // those are left out rather than saved blank.
    dates: targetDate
      ? template.dates.map((d) => ({ label: d.label, date: addDays(targetDate, d.days) }))
      : [],
  };
}

export function taskProgress(tasks) {
  const total = (tasks || []).length;
  const done = (tasks || []).filter((t) => t.status === 'done').length;
  return { done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export function isPastDue(dateString, today) {
  return Boolean(dateString) && dateString < today;
}

// The soonest thing still to happen: an unticked key date or an unfinished
// task with a due date. Late ones count - they are the most urgent.
export function nextDeadline({ dates = [], tasks = [] }, today) {
  const candidates = [
    ...dates.filter((d) => !d.done && d.date).map((d) => ({ label: d.label, date: d.date, type: 'date' })),
    ...tasks.filter((t) => t.status !== 'done' && t.due_date).map((t) => ({ label: t.title, date: t.due_date, type: 'task' })),
  ];
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type === 'date' ? -1 : 1));
  const next = candidates[0];
  return { ...next, overdue: isPastDue(next.date, today) };
}

export function overdueTaskCount(tasks, today) {
  return (tasks || []).filter((t) => t.status !== 'done' && isPastDue(t.due_date, today)).length;
}

// Whole days from today to a date (negative when it has passed).
export function daysUntil(dateString, today) {
  if (!dateString || !today) return null;
  const toUtc = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(dateString) - toUtc(today)) / 86400000);
}

export function describeDaysUntil(dateString, today) {
  const n = daysUntil(dateString, today);
  if (n === null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n < 0) return `${-n} days ago`;
  return `in ${n} days`;
}

// The projects tables not existing yet means 0137 hasn't been run.
export function isMissingTable(error) {
  return Boolean(error) && (error.code === '42P01' || error.code === 'PGRST205');
}

export function safeFileName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9.\-_]/g, '_');
}
