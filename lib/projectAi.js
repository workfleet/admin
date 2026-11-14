// AI tools on a project: the prompts, the shape of what comes back, and the
// checks applied to it before anything is shown. Kept apart from the route
// so it can be tested without calling the API.
//
// Two tools:
//  - "tasks": read one document (a tender pack, a client brief, an ISO
//    checklist) and suggest the tasks and key dates in it. Nothing is
//    saved - the office ticks which ones to keep.
//  - "draft": write a first draft of something (a method statement, a
//    client update) from the project's own details and, optionally, files.
//
// Both say plainly what they don't know instead of filling the gap: in a
// bid, anything claimed is binding.

export const AI_MODEL = 'claude-opus-5-5';

// What Claude can read directly. Word files can't be sent as they are -
// the office saves them as PDF first.
const PDF_TYPES = new Set(['pdf']);
const TEXT_TYPES = new Set(['txt', 'md', 'csv']);
const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_DRAFT_FILES = 3;

export function fileExtension(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

// 'pdf' | 'text' | 'image' | null (can't be read).
export function readableKind(fileName) {
  const ext = fileExtension(fileName);
  if (PDF_TYPES.has(ext)) return 'pdf';
  if (TEXT_TYPES.has(ext)) return 'text';
  if (IMAGE_TYPES[ext]) return 'image';
  return null;
}

export function unreadableReason(fileName) {
  const ext = fileExtension(fileName);
  if (ext === 'doc' || ext === 'docx') return 'Word files can\'t be read directly - save it as a PDF and upload that.';
  if (ext === 'xls' || ext === 'xlsx') return 'Spreadsheets can\'t be read directly - save the sheet as CSV or PDF and upload that.';
  return 'Only PDF, text, CSV and image files can be read.';
}

// One content block for the Messages API from a downloaded file.
export function contentBlockFor(fileName, buffer) {
  const kind = readableKind(fileName);
  if (kind === 'pdf') {
    return { type: 'document', title: fileName, source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } };
  }
  if (kind === 'text') {
    return { type: 'document', title: fileName, source: { type: 'text', media_type: 'text/plain', data: buffer.toString('utf8') } };
  }
  if (kind === 'image') {
    return { type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[fileExtension(fileName)], data: buffer.toString('base64') } };
  }
  return null;
}

// A plain-text picture of the project, for both tools.
export function projectContext({ project, tasks = [], dates = [], notes = [], kindLabel, ownerName, today }) {
  const lines = [
    `Today's date: ${today}`,
    `Project: ${project.name}`,
    `Type: ${kindLabel}`,
    project.clients?.name ? `Client: ${project.clients.name}` : null,
    project.properties?.address ? `Site: ${project.properties.address}` : null,
    ownerName ? `Owner: ${ownerName}` : null,
    project.due_date ? `Target date: ${project.due_date}` : null,
    project.description ? `About: ${project.description}` : null,
  ].filter(Boolean);

  if (dates.length) {
    lines.push('', 'Key dates:');
    dates.forEach((d) => lines.push(`- ${d.date} ${d.label}${d.done ? ' (done)' : ''}`));
  }
  if (tasks.length) {
    lines.push('', 'Tasks already on the project:');
    tasks.forEach((t) => lines.push(`- [${t.status === 'done' ? 'x' : ' '}] ${t.title}${t.due_date ? ` (due ${t.due_date})` : ''}`));
  }
  const written = notes.filter((n) => n.kind === 'note').slice(0, 20);
  if (written.length) {
    lines.push('', 'Notes the office has written (newest first):');
    written.forEach((n) => lines.push(`- ${n.created_at.slice(0, 10)}: ${n.body}`));
  }
  return lines.join('\n');
}

export const TASKS_SYSTEM = `You help the office of a UK commercial cleaning company run its projects: tenders, new contract start-ups, deep cleans and certifications.

You will be given one document and a summary of the project it belongs to. List the work the document asks for, so the office can plan it.

- Tasks are things someone has to do or produce: a form to fill in, a certificate to supply, a question to answer, a site visit to attend. Write each as a short instruction (under 15 words), in plain British English.
- Include every document, form, annex, schedule or certificate the document says must be submitted, each as its own task, using the document's own name for it (for example "Complete Annex 2 pricing schedule").
- Pass/fail or mandatory requirements go in as tasks too, with the requirement in the notes.
- Key dates are deadlines or fixed events stated in the document: clarification questions closing, submission deadline, site visit, contract start. Only use dates the document states. Give dates as YYYY-MM-DD. If a deadline has a time, put it in the label ("Submission deadline - 12:00").
- A task's due date is only set when the document ties it to a date. Otherwise leave it null; do not guess.
- Skip anything already in the project's task list.
- Never invent requirements, dates or figures. If something is unclear, say so in "warnings".
- "summary" is two or three sentences on what the document is and what it asks for.`;

export const TASKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'tasks', 'dates', 'warnings'],
  properties: {
    summary: { type: 'string' },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'due_date', 'notes', 'source'],
        properties: {
          title: { type: 'string' },
          due_date: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null when the document gives no date' },
          notes: { type: ['string', 'null'] },
          source: { type: ['string', 'null'], description: 'Where in the document it comes from, e.g. "Section 4.2" or "page 12"' },
        },
      },
    },
    dates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'date', 'source'],
        properties: {
          label: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          source: { type: ['string', 'null'] },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? s : null;
}

function cleanText(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
}

// The suggestions, made safe to show: bad dates dropped to null, empty
// titles removed, lengths capped, duplicates of existing tasks removed.
export function cleanTaskSuggestions(raw, existingTitles = []) {
  const existing = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  const seen = new Set();
  const tasks = [];
  for (const t of Array.isArray(raw?.tasks) ? raw.tasks : []) {
    const title = cleanText(t?.title, 200);
    if (!title) continue;
    const key = title.toLowerCase();
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    tasks.push({ title, due_date: validDate(t.due_date), notes: cleanText(t.notes, 1000), source: cleanText(t.source, 120) });
  }
  const dates = [];
  for (const d of Array.isArray(raw?.dates) ? raw.dates : []) {
    const label = cleanText(d?.label, 200);
    const date = validDate(d?.date);
    if (!label || !date) continue;
    dates.push({ label, date, source: cleanText(d.source, 120) });
  }
  const warnings = (Array.isArray(raw?.warnings) ? raw.warnings : []).map((w) => cleanText(w, 400)).filter(Boolean);
  return { summary: cleanText(raw?.summary, 1200) || '', tasks: tasks.slice(0, 80), dates: dates.slice(0, 30), warnings: warnings.slice(0, 10) };
}

export const DRAFT_TYPES = [
  { value: 'free', label: 'Anything (describe it below)' },
  { value: 'method_statement', label: 'Method statement' },
  { value: 'mobilisation_plan', label: 'Mobilisation / start-up plan' },
  { value: 'tender_answer', label: 'Answer to a tender question' },
  { value: 'client_update', label: 'Update email to the client' },
  { value: 'status_summary', label: 'Where the project stands (summary)' },
  { value: 'risk_assessment', label: 'Risk assessment outline' },
];

export function draftTypeLabel(value) {
  return DRAFT_TYPES.find((t) => t.value === value)?.label || 'Draft';
}

export const DRAFT_SYSTEM = `You write first drafts for the office of CrewConnect Cleaning, a UK commercial cleaning company. The office will check and edit everything you write before it is used.

Rules:
- Use only facts from the project details, the notes and any attached files. Never invent names, numbers, prices, dates, staff, equipment, certifications, accreditations, insurance, policies, past contracts or results.
- Where the draft needs a fact you don't have, write a placeholder in square brackets saying what is needed, like [CONFIRM: number of cleaners on nights] or [ADD: insurance certificate number]. A draft full of placeholders is better than one with invented facts.
- Never claim the company holds a certification, has a system or does something unless the material you were given says so. "Working towards" is only allowed if the material says it.
- Plain British English (organise, colour, programme). Short paragraphs. Headings only where the document type normally has them.
- No preamble or sign-off about yourself; start with the draft itself.
- At the end, after a line containing only "---", list every placeholder you used, one per line, so the office can fill them in. If you used none, leave the list out.`;

export function draftPrompt({ draftType, instruction, context }) {
  const what = draftType && draftType !== 'free' ? draftTypeLabel(draftType) : 'The document described below';
  return [
    `Write: ${what}`,
    instruction ? `What the office asked for:\n${instruction}` : null,
    '',
    'Project details:',
    context,
  ].filter((x) => x !== null).join('\n');
}

// Splits a draft into the text and the "fill these in" list after "---".
export function splitDraft(text) {
  const s = String(text || '');
  const idx = s.search(/\n-{3,}\s*\n/);
  if (idx === -1) return { body: s.trim(), placeholders: [] };
  const body = s.slice(0, idx).trim();
  const placeholders = s.slice(idx).replace(/^\s*-{3,}\s*/, '').split('\n')
    .map((l) => l.replace(/^[-*\s]+/, '').trim())
    .filter(Boolean);
  return { body, placeholders };
}
