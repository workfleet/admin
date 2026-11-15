// Changing Excel and Word files for the project chat. Server-only.
//
// The original file is never touched: every change is saved as a new copy
// on the project ("Pricing model (updated 15 Nov 2026).xlsx"), so a wrong
// edit costs nothing but a delete.
//
// Excel: individual cells are set (a number, text, or a formula starting
// "="). Formulas elsewhere are kept and Excel recalculates them when the
// copy is opened. Word: exact text is replaced wherever it appears in the
// body, headers and footers, inside one run of formatting - text split by
// formatting changes (half bold, say) isn't found, and the result says so.
import JSZip from 'jszip';
import { decodeXml } from './officeText';

const MAX_CELLS = 4000;

function cellValueText(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) return '';
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return String(v.error);
    if ('result' in v) return String(v.result ?? '');
  }
  return String(v);
}

function formulaOf(cell) {
  const v = cell.value;
  if (v && typeof v === 'object') return v.formula || v.sharedFormula || null;
  return null;
}

function resultOf(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && 'result' in v) {
    const r = v.result;
    if (r instanceof Date) return r.toISOString().slice(0, 10);
    return r == null ? '' : String(r);
  }
  return null;
}

async function loadWorkbook(buffer) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

// Every non-empty cell with its address, so the AI can say exactly which
// cell to change: "B4 = 13" or "D9 = =B4*C9 (= 702.00)".
export async function xlsxCellsText(buffer) {
  const wb = await loadWorkbook(buffer);
  const parts = [];
  let total = 0;
  wb.eachSheet((sheet) => {
    if (sheet.state && sheet.state !== 'visible') return;
    const lines = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (total >= MAX_CELLS) return;
      const cells = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (total >= MAX_CELLS) return;
        const f = formulaOf(cell);
        const text = f ? `=${f} (= ${resultOf(cell) ?? '?'})` : cellValueText(cell).replace(/\s*\n\s*/g, ' ').trim();
        if (!text) return;
        cells.push(`${cell.address}: ${text.slice(0, 200)}`);
        total += 1;
      });
      if (cells.length) lines.push(cells.join(' | '));
    });
    if (lines.length) parts.push(`## Sheet "${sheet.name}"\n${lines.join('\n')}`);
  });
  const text = parts.join('\n\n');
  return total >= MAX_CELLS ? `${text}\n\n(Only the first ${MAX_CELLS} filled cells are shown.)` : text;
}

function parseValue(raw) {
  if (typeof raw === 'number') return raw;
  const s = String(raw ?? '').trim();
  if (s.startsWith('=')) return { formula: s.slice(1) };
  const num = s.replace(/[£,]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(num)) return Number(num);
  if (/^-?\d+(\.\d+)?%$/.test(num)) return Number(num.slice(0, -1)) / 100;
  return s;
}

function describeCell(cell) {
  const f = formulaOf(cell);
  return f ? `=${f}` : cellValueText(cell);
}

// Checks (and with save: true, makes) a set of cell changes.
// edits: [{ sheet, cell, value }]. Returns { changes: [{ sheet, cell, from,
// to, label }], errors: [...] } and, when saving, the new file's buffer.
export async function editXlsx(buffer, edits, { save = false } = {}) {
  const wb = await loadWorkbook(buffer);
  const changes = [];
  const errors = [];
  for (const e of (edits || []).slice(0, 100)) {
    // The sheet must be named - matched ignoring case - so a wrong name
    // never lands on a different sheet.
    const wanted = String(e?.sheet || '').trim().toLowerCase();
    const sheet = wb.worksheets.find((w) => w.name.trim().toLowerCase() === wanted) || null;
    if (!sheet) { errors.push(`There is no sheet called "${e?.sheet}".`); continue; }
    const address = String(e?.cell || '').toUpperCase().trim();
    if (!/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(address)) { errors.push(`"${e?.cell}" isn't a cell address.`); continue; }
    const cell = sheet.getCell(address);
    const from = describeCell(cell);
    const value = parseValue(e?.value);
    const to = typeof value === 'object' ? `=${value.formula}` : String(value);
    if (from === to) continue;
    // The label in the cell to the left, when there is one, so the card can
    // say "Day rate (B4): 13 -> 13.21".
    const col = cell.col > 1 ? sheet.getCell(cell.row, cell.col - 1) : null;
    const label = col ? cellValueText(col).trim().slice(0, 60) : '';
    changes.push({ sheet: sheet.name, cell: address, from, to, label });
    if (save) cell.value = value;
  }
  if (!save) return { changes, errors };
  // Excel works the formulas out again when the copy is opened.
  wb.calcProperties.fullCalcOnLoad = true;
  const out = Buffer.from(await wb.xlsx.writeBuffer());
  return { changes, errors, buffer: out };
}

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const WORD_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

// Exact text replacements in a .docx. Returns { counts: [{ find, replace,
// count }] } and, when saving, the new file's buffer.
export async function editDocx(buffer, replacements, { save = false } = {}) {
  const zip = await JSZip.loadAsync(buffer);
  const list = (replacements || [])
    .map((r) => ({ find: String(r?.find || ''), replace: String(r?.replace ?? '') }))
    .filter((r) => r.find.trim())
    .slice(0, 50);
  const counts = list.map((r) => ({ ...r, count: 0 }));
  const names = Object.keys(zip.files).filter((n) => WORD_PARTS.test(n));
  for (const name of names) {
    let xml = await zip.file(name).async('string');
    let changed = false;
    xml = xml.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (whole, open, inner, close) => {
      let text = decodeXml(inner);
      let hit = false;
      counts.forEach((c) => {
        if (!text.includes(c.find)) return;
        const n = text.split(c.find).length - 1;
        c.count += n;
        text = text.split(c.find).join(c.replace);
        hit = true;
      });
      if (!hit) return whole;
      changed = true;
      // Keep spaces at the ends of the run.
      const openTag = /xml:space=/.test(open) ? open : open.replace('<w:t', '<w:t xml:space="preserve"');
      return `${openTag}${escapeXml(text)}${close}`;
    });
    if (changed && save) zip.file(name, xml);
  }
  if (!save) return { counts };
  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { counts, buffer: out };
}

// "Pricing model.xlsx" -> "Pricing model (updated 15 Nov 2026).xlsx"
export function updatedName(fileName, dateLabel) {
  const m = /^(.*?)(\.[^.]+)?$/.exec(String(fileName || 'file'));
  const base = m[1].replace(/\s*\(updated [^)]*\)\s*$/, '');
  return `${base} (updated ${dateLabel})${m[2] || ''}`;
}
