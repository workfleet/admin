import { describe, it, expect } from 'vitest';
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, LevelFormat, AlignmentType } from 'docx';
import ExcelJS from 'exceljs';
import { docxToText, xlsxToText, officeToText, decodeXml, MAX_OFFICE_CHARS } from '../lib/officeText';
import { readableKind, unreadableReason, contentBlockFor } from '../lib/projectAi';

async function makeDocx() {
  const doc = new Document({
    numbering: { config: [{ reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT }] }] },
    sections: [{
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Invitation to Tender')] }),
        new Paragraph({ children: [new TextRun('Return by 12:00 on 26 November & no later.')] }),
        new Paragraph({ numbering: { reference: 'b', level: 0 }, children: [new TextRun('Annex 2 pricing schedule')] }),
        new Table({
          rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph('Lot')] }), new TableCell({ children: [new Paragraph('Hours')] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph('Day')] }), new TableCell({ children: [new Paragraph('54')] })] }),
          ],
        }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

describe('Word files', () => {
  it('keeps headings, text, bullets and tables', async () => {
    const text = await docxToText(await makeDocx());
    expect(text).toContain('# Invitation to Tender');
    expect(text).toContain('Return by 12:00 on 26 November & no later.');
    expect(text).toContain('- Annex 2 pricing schedule');
    expect(text).toContain('| Lot | Hours |');
    expect(text).toContain('| Day | 54 |');
  });

  it('refuses something that is not a Word file', async () => {
    await expect(docxToText(Buffer.from('not a zip'))).rejects.toThrow();
  });

  it('decodes XML entities', () => {
    expect(decodeXml('A &amp; B &lt;3 &#163;5 &#x2019;')).toBe('A & B <3 £5 ’');
  });
});

describe('Excel files', () => {
  it('turns each visible sheet into a table, with formula results', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Pricing');
    ws.addRow(['Item', 'Rate', 'Hours', 'Total']);
    ws.addRow(['Day', 24.48, 54, { formula: 'B2*C2', result: 1321.92 }]);
    ws.addRow([]);
    ws.addRow(['Night', 31.86, 26]);
    const hidden = wb.addWorksheet('Workings');
    hidden.state = 'hidden';
    hidden.addRow(['secret']);
    const text = await xlsxToText(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(text).toContain('## Sheet: Pricing');
    expect(text).toContain('| Item | Rate | Hours | Total |');
    expect(text).toContain('| Day | 24.48 | 54 | 1321.92 |');
    expect(text).toContain('| Night | 31.86 | 26 |');
    expect(text).not.toContain('secret');
  });

  it('caps very long files and says so', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Big');
    for (let i = 0; i < 2000; i++) ws.addRow(['x'.repeat(200), i]);
    const text = await officeToText('excel', Buffer.from(await wb.xlsx.writeBuffer()));
    expect(text.length).toBeLessThanOrEqual(MAX_OFFICE_CHARS + 100);
    expect(text).toMatch(/rest was not included/);
  });
});

describe('which files the AI can read', () => {
  it('now includes Word and Excel, not the old formats', () => {
    expect(readableKind('Annex 1.docx')).toBe('word');
    expect(readableKind('Pricing.XLSX')).toBe('excel');
    expect(readableKind('Old.doc')).toBeNull();
    expect(unreadableReason('Old.doc')).toMatch(/\.docx/);
    expect(unreadableReason('Old.xls')).toMatch(/\.xlsx/);
  });

  it('sends unpacked Word text as a text document', () => {
    expect(contentBlockFor('a.docx', Buffer.from(''), 'hello').source).toEqual({ type: 'text', media_type: 'text/plain', data: 'hello' });
  });
});
