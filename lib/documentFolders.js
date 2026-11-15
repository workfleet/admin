// Folders in the Documents library: grouping, search, and the AI tidy-up
// that suggests a folder for each document from its name.

// Folder categories (0141). A document takes its folder's category; only
// "contract" changes anything - those are admin-only in the AI chat.
export const FOLDER_KINDS = [
  { value: 'other', label: 'Ordinary folder' },
  { value: 'contract', label: 'Contracts (admins only in the AI chat)' },
];

export const UNSORTED = '__unsorted__';

// [{ folder, docs }] in folder order, plus "Unsorted" for anything without
// a folder, leaving out empty folders only when searching.
export function groupByFolder(folders, docs, { keepEmpty = true } = {}) {
  const byId = new Map(folders.map((f) => [f.id, []]));
  const unsorted = [];
  for (const d of docs) {
    if (d.folder_id && byId.has(d.folder_id)) byId.get(d.folder_id).push(d);
    else unsorted.push(d);
  }
  const groups = folders.map((f) => ({ folder: f, docs: byId.get(f.id) })).filter((g) => keepEmpty || g.docs.length);
  if (unsorted.length) groups.push({ folder: { id: UNSORTED, name: 'Unsorted', category: 'other' }, docs: unsorted });
  return groups;
}

export function matchesSearch(doc, folderName, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return true;
  return [doc.title, doc.file_name, folderName].some((x) => String(x || '').toLowerCase().includes(s));
}

// Folder order after moving one up or down: [{ id, position }] to save.
export function reorder(folders, id, dir) {
  const list = [...folders].sort((a, b) => a.position - b.position);
  const i = list.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j], list[i]];
  return list.map((f, n) => ({ id: f.id, position: (n + 1) * 10 })).filter((p) => folders.find((f) => f.id === p.id).position !== p.position);
}

export const SORT_SYSTEM = `You sort a UK cleaning company's document library into its folders, from each document's title and file name only.

For every document, pick the best folder from the list. Rules of thumb:
- RAMS, risk assessments, method statements, safe systems of work -> a RAMS folder.
- Safety data sheets (SDS, MSDS) and COSHH assessments -> a COSHH folder.
- Insurance certificates or schedules -> an Insurance folder.
- Certificates, accreditations, memberships (SafeContractor, CHAS, ISO) -> a certificates folder.
- Toolbox talks, handbooks, training records, induction material -> a Training folder.
- Company policies and procedures -> a Policies folder.
- Contracts with staff or clients -> a Contracts folder.
- Anything that fits none -> Other.
Use only folder ids from the list. Give a short reason (a few words) for each. If a name is too vague to tell, leave it where it is.`;

export const SORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documents'],
  properties: {
    documents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'folder_id', 'reason'],
        properties: { id: { type: 'string' }, folder_id: { type: 'string' }, reason: { type: 'string' } },
      },
    },
  },
};

export function sortRequestText(folders, docs) {
  return [
    'Folders:',
    ...folders.map((f) => `- ${f.id}: ${f.name}`),
    '',
    'Documents (id | title | file name | current folder id):',
    ...docs.map((d) => `- ${d.id} | ${d.title} | ${d.file_name} | ${d.folder_id || 'none'}`),
  ].join('\n');
}

// Only real documents and folders, only actual moves, and never out of a
// contracts folder (signed worker contracts must stay protected).
export function cleanSortSuggestions(raw, folders, docs) {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const docById = new Map(docs.map((d) => [d.id, d]));
  const seen = new Set();
  const out = [];
  for (const s of Array.isArray(raw?.documents) ? raw.documents : []) {
    const doc = docById.get(s?.id);
    const to = folderById.get(s?.folder_id);
    if (!doc || !to || seen.has(doc.id)) continue;
    seen.add(doc.id);
    if (doc.folder_id === to.id) continue;
    const from = folderById.get(doc.folder_id);
    if (from?.category === 'contract' && to.category !== 'contract') continue;
    out.push({ id: doc.id, title: doc.title, from_folder_id: doc.folder_id || null, folder_id: to.id, reason: String(s.reason || '').slice(0, 120) });
  }
  return out;
}
