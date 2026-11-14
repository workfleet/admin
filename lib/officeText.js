// Word (.docx) and Excel (.xlsx) files as text the AI can read. Claude takes
// PDFs, plain text and images directly, but not Office files, so the server
// unpacks them first. Server-only.
//
// What survives: the words, headings, bullet and numbered lists, and tables
// (as rows of cells). What doesn't: layout, pictures, text boxes, comments
// and tracked changes - for a tender pack or a pricing sheet, the words and
// the tables are what matter.
import JSZip from 'jszip';

// Plenty for a long tender pack; past this the text is cut and says so.
export const MAX_OFFICE_CHARS = 300000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

// The text of one <w:p> paragraph, with its heading level or list marker.
function paragraphText(xml) {
  let text = '';
  // Text, tabs and line breaks in document order.
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[1] !== undefined) text += decodeXml(m[1]);
    else if (m[0].startsWith('<w:tab')) text += '\t';
    else text += '\n';
  }
  text = text.replace(/[ \t]+$/g, '');
  if (!text.trim()) return '';
  const style = /<w:pStyle w:val="([^"]+)"/.exec(xml)?.[1] || '';
  const heading = /^(?:Heading|heading)\s?(\d)$/.exec(style) || (style === 'Title' ? [null, '1'] : null);
  if (heading) return `${'#'.repeat(Math.min(Number(heading[1]), 3))} ${text.trim()}`;
  if (/<w:numPr>/.test(xml) || /List/i.test(style)) return `- ${text.trim()}`;
  return text;
}

// Splits XML into its top-level <tag>...</tag> blocks, keeping nesting.
function topLevel(xml, tags) {
  const out = [];
  const open = new RegExp(`<(${tags.join('|')})(?=[\\s>/])`, 'g');
  let m;
  while ((m = open.exec(xml))) {
    const tag = m[1];
    const start = m.index;
    // Self-closing
    const selfClose = xml.indexOf('>', start);
    if (xml[selfClose - 1] === '/') { open.lastIndex = selfClose + 1; continue; }
    let depth = 0;
    const scan = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*?(/?)>`, 'g');
    scan.lastIndex = start;
    let s;
    let end = -1;
    while ((s = scan.exec(xml))) {
      if (s[2] === '/') continue;
      if (s[1] === '/') { depth -= 1; if (depth === 0) { end = scan.lastIndex; break; } } else depth += 1;
    }
    if (end === -1) break;
    out.push({ tag, xml: xml.slice(start, end) });
    open.lastIndex = end;
  }
  return out;
}

function tableText(xml) {
  const rows = topLevel(xml, ['w:tr']).map((row) => topLevel(row.xml, ['w:tc']).map((cell) => (
    topLevel(cell.xml, ['w:p', 'w:tbl'])
      .map((b) => (b.tag === 'w:p' ? paragraphText(b.xml) : tableText(b.xml)))
      .filter(Boolean).join(' / ')
      .replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim()
  )));
  const used = rows.filter((r) => r.some((c) => c));
  if (!used.length) return '';
  return used.map((r) => `| ${r.join(' | ')} |`).join('\n');
}

// .docx -> text with light markup (# headings, - bullets, | tables |).
export async function docxToText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('not a Word document');
  const xml = await doc.async('string');
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] || xml;
  const blocks = topLevel(body, ['w:p', 'w:tbl'])
    .map((b) => (b.tag === 'w:p' ? paragraphText(b.xml) : tableText(b.xml)))
    .filter(Boolean);
  return blocks.join('\n\n');
}

function cellText(cell) {
  const v = cell?.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return v.result == null ? '' : String(v.result instanceof Date ? v.result.toISOString().slice(0, 10) : v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return String(v.error);
  }
  return String(cell.text ?? v);
}

// .xlsx -> one table per sheet, empty rows and trailing empty columns
// dropped. Formulas give their last calculated value.
export async function xlsxToText(buffer, { maxRows = 2000, maxCols = 60 } = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const parts = [];
  wb.eachSheet((sheet) => {
    if (sheet.state && sheet.state !== 'visible') return;
    const rows = [];
    let truncated = false;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= maxRows) { truncated = true; return; }
      const cells = [];
      for (let c = 1; c <= Math.min(row.cellCount, maxCols); c++) cells.push(cellText(row.getCell(c)).replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim());
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some((x) => x)) rows.push(`| ${cells.join(' | ')} |`);
    });
    if (rows.length) parts.push(`## Sheet: ${sheet.name}\n${rows.join('\n')}${truncated ? `\n(Only the first ${maxRows} rows are included.)` : ''}`);
  });
  return parts.join('\n\n');
}

// Either kind, capped, with a note when cut short.
export async function officeToText(kind, buffer) {
  const text = kind === 'word' ? await docxToText(buffer) : await xlsxToText(buffer);
  if (text.length <= MAX_OFFICE_CHARS) return text;
  return `${text.slice(0, MAX_OFFICE_CHARS)}\n\n(The file is longer than this - the rest was not included.)`;
}
