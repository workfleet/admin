// Folders for a project's files (0142): the project keeps an ordered list
// of names, each file names its folder. These helpers keep the two in step.

export const UNFILED = '';

export function cleanFolderName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function same(a, b) {
  return cleanFolderName(a).toLowerCase() === cleanFolderName(b).toLowerCase();
}

// The project's list plus any folder a file names that isn't on it.
export function allFolders(list, files) {
  const out = [...(list || [])];
  for (const f of files || []) {
    if (f.folder && !out.some((x) => same(x, f.folder))) out.push(f.folder);
  }
  return out;
}

// [{ folder, files }] in folder order, "Not in a folder" last; empty
// folders kept so they can be filled.
export function groupProjectFiles(list, files) {
  const folders = allFolders(list, files);
  const groups = folders.map((name) => ({ folder: name, files: files.filter((f) => f.folder && same(f.folder, name)) }));
  const loose = files.filter((f) => !f.folder || !folders.some((x) => same(x, f.folder)));
  if (loose.length) groups.push({ folder: UNFILED, files: loose });
  return groups;
}

export function withFolder(list, name) {
  const n = cleanFolderName(name);
  if (!n || (list || []).some((x) => same(x, n))) return list || [];
  return [...(list || []), n];
}

export function withoutFolder(list, name) {
  return (list || []).filter((x) => !same(x, name));
}

export function renamedFolder(list, from, to) {
  const n = cleanFolderName(to);
  return (list || []).map((x) => (same(x, from) ? n : x));
}

// The matching name as the project spells it, or the cleaned new name.
export function canonicalFolder(list, name) {
  const n = cleanFolderName(name);
  return (list || []).find((x) => same(x, n)) || n;
}
