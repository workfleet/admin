import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { xlsxCellsText, editXlsx, editDocx, updatedName } from '../lib/officeEdit';
import { docxToText } from '../lib/officeText';
import { describeProjectChange, projectChatContext, PROJECT_CHANGE_TYPES, PROJECT_TOOLS } from '../lib/projectChat';
import { applyOrder } from '../lib/projectChatActions';

async function pricingSheet() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Assumptions');
  ws.getCell('A1').value = 'Hourly pay';
  ws.getCell('B1').value = 13;
  ws.getCell('A2').value = 'Hours per week';
  ws.getCell('B2').value = 54;
  ws.getCell('A3').value = 'Weekly wages';
  ws.getCell('B3').value = { formula: 'B1*B2', result: 702 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Excel edits', () => {
  it('lists cells with addresses and formulas', async () => {
    const text = await xlsxCellsText(await pricingSheet());
    expect(text).toContain('## Sheet "Assumptions"');
    expect(text).toContain('B1: 13');
    expect(text).toContain('B3: =B1*B2 (= 702)');
  });

  it('previews a change with the label beside the cell, without saving', async () => {
    const { changes, errors, buffer } = await editXlsx(await pricingSheet(), [{ sheet: 'Assumptions', cell: 'b1', value: '£13.21' }]);
    expect(changes).toEqual([{ sheet: 'Assumptions', cell: 'B1', from: '13', to: '13.21', label: 'Hourly pay' }]);
    expect(errors).toEqual([]);
    expect(buffer).toBeUndefined();
  });

  it('saves a copy with the new value and the formulas kept', async () => {
    const { buffer } = await editXlsx(await pricingSheet(), [{ sheet: 'Assumptions', cell: 'B1', value: '13.21' }], { save: true });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet('Assumptions');
    expect(ws.getCell('B1').value).toBe(13.21);
    expect(ws.getCell('B3').value.formula).toBe('B1*B2');
    const xml = await (await (await import('jszip')).default.loadAsync(buffer)).file('xl/workbook.xml').async('string');
    expect(xml).toMatch(/fullCalcOnLoad="1"/);
  });

  it('reports bad sheets and cells, and skips no-change edits', async () => {
    const { changes, errors } = await editXlsx(await pricingSheet(), [
      { sheet: 'Nope', cell: 'B1', value: '1' },
      { sheet: 'Assumptions', cell: 'B1:B2', value: '1' },
      { sheet: 'Assumptions', cell: 'B2', value: '54' },
    ]);
    expect(changes).toEqual([]);
    expect(errors).toHaveLength(2);
  });
});

describe('Word edits', () => {
  it('replaces exact text and keeps the rest', async () => {
    const doc = new Document({ sections: [{ children: [
      new Paragraph({ children: [new TextRun('All staff are paid at least £13.00 an hour.')] }),
      new Paragraph({ children: [new TextRun('Rates are reviewed each April. £13.00 applies to nights too.')] }),
    ] }] });
    const original = await Packer.toBuffer(doc);
    const preview = await editDocx(original, [{ find: '£13.00', replace: '£13.21' }, { find: 'not there', replace: 'x' }]);
    expect(preview.counts.map((c) => c.count)).toEqual([2, 0]);
    const { buffer } = await editDocx(original, [{ find: '£13.00', replace: '£13.21' }], { save: true });
    const text = await docxToText(buffer);
    expect(text).toContain('paid at least £13.21 an hour');
    expect(text).toContain('£13.21 applies to nights too');
    expect(text).not.toContain('£13.00');
  });

  it('names the new copy and replaces an old "updated" date', () => {
    expect(updatedName('Pricing model.xlsx', '15 Nov 2026')).toBe('Pricing model (updated 15 Nov 2026).xlsx');
    expect(updatedName('Pricing model (updated 1 Nov 2026).xlsx', '15 Nov 2026')).toBe('Pricing model (updated 15 Nov 2026).xlsx');
  });
});

describe('project chat changes', () => {
  it('describes each kind of change for the card', () => {
    expect(describeProjectChange({ type: 'add_task', title: 'Re-price nights', due_date: '2026-11-20' }).headline).toBe('Add task: Re-price nights');
    expect(describeProjectChange({ type: 'update_task', status: 'done', from: { title: 'Pricing', status: 'to_do' } }).details).toEqual(['Mark done']);
    const sheet = describeProjectChange({ type: 'edit_spreadsheet', fileName: 'Pricing.xlsx', summary: 'NLW from April', changes: [{ sheet: 'Assumptions', cell: 'B1', from: '13', to: '13.21', label: 'Hourly pay' }] });
    expect(sheet.headline).toBe('New copy of Pricing.xlsx');
    expect(sheet.details).toEqual(['NLW from April', 'Assumptions B1 (Hourly pay): 13 → 13.21']);
  });

  it('applies notes first and files last', () => {
    expect(applyOrder([{ type: 'edit_word' }, { type: 'add_task' }, { type: 'add_note' }, { type: 'update_date' }])).toEqual([2, 1, 3, 0]);
  });

  it('gives the AI ids for tasks, dates and files', () => {
    const text = projectChatContext({
      project: { name: 'Bus Station', kind: 'tender', status: 'active' },
      tasks: [{ id: 't1', status: 'to_do', due_date: '2026-11-20', title: 'Pricing', notes: null }],
      dates: [{ id: 'd1', date: '2026-11-26', done: false, label: 'Submit' }],
      files: [{ id: 'f1', file_name: 'Pricing.xlsx' }],
      today: '2026-11-15',
    });
    expect(text).toContain('- t1 | to_do | 2026-11-20 | Pricing');
    expect(text).toContain('- d1 | 2026-11-26 | open | Submit');
    expect(text).toContain('- f1 | Pricing.xlsx');
  });

  it('lets the tool propose every supported change', () => {
    const t = PROJECT_TOOLS.find((x) => x.name === 'propose_project_changes');
    expect(t.input_schema.properties.changes.items.properties.type.enum).toEqual(PROJECT_CHANGE_TYPES);
  });
});
