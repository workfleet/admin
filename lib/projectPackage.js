// Packaging a project's files: one zip, numbered in upload order, with a
// contents sheet (Word) at the top - and, when the "what's missing" check
// has run, its result in that sheet too.
//
// Built in the browser, not on the server: a tender pack is easily bigger
// than the 4.5 MB a server response may be, and the browser already has
// each file through its own signed link.

export function safePart(name, max = 80) {
  return String(name || 'file').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) || 'file';
}

// "01 - Pricing.xlsx", in the order the files were added. Two files with
// the same name stay apart because of the number.
export function packageEntries(files) {
  const sorted = [...(files || [])].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const width = String(sorted.length).length < 2 ? 2 : String(sorted.length).length;
  return sorted.map((f, i) => ({
    ...f,
    number: i + 1,
    zipName: `${String(i + 1).padStart(width, '0')} - ${safePart(f.file_name, 120)}`,
  }));
}

export function zipFileName(projectName, today) {
  return `${safePart(projectName, 60)} - documents ${today}.zip`;
}

function sizeLabel(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_WORDS = { present: 'Uploaded', missing: 'MISSING', unclear: 'Check' };

// The contents sheet as light markup for lib/draftDocx.js.
export function contentsMarkdown({ project, entries, check, nameOf, todayLabel }) {
  const lines = [`# ${project.name} - documents`, '', `Packaged ${todayLabel}. ${entries.length} file${entries.length === 1 ? '' : 's'}.`];
  if (project.clients?.name) lines.push(`Client: ${project.clients.name}`);
  if (project.due_date) lines.push(`Target date: ${project.due_date}`);
  lines.push('', '## Files');
  entries.forEach((e) => {
    const who = nameOf?.(e.uploaded_by);
    lines.push(`- **${e.zipName}**${[sizeLabel(e.file_size), who ? `added by ${who}` : null].filter(Boolean).length ? ` (${[sizeLabel(e.file_size), who ? `added by ${who}` : null].filter(Boolean).join(', ')})` : ''}`);
  });
  if (check?.items?.length) {
    const missing = check.items.filter((i) => i.status === 'missing').length;
    lines.push('', '## Checklist', `Checked against ${check.against}. ${missing ? `${missing} item${missing === 1 ? '' : 's'} not found in the files.` : 'Every item was matched to a file.'} This check was made by AI - confirm it before submitting.`);
    check.items.forEach((i) => {
      lines.push(`- **${STATUS_WORDS[i.status] || i.status}:** ${i.item}${i.files?.length ? ` - ${i.files.join(', ')}` : ''}${i.note ? ` (${i.note})` : ''}`);
    });
  }
  return lines.join('\n');
}
