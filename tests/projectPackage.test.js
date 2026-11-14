import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { Packer } from 'docx';
import { packageEntries, zipFileName, contentsMarkdown, safePart } from '../lib/projectPackage';
import { cleanCheck, CHECK_SCHEMA } from '../lib/projectAi';
import { buildDraftDocx } from '../lib/draftDocx';
import { COMPANY } from '../lib/companyBranding';

const files = [
  { id: 'b', file_name: 'Annex 2 pricing.xlsx', file_size: 20480, uploaded_by: 'u1', created_at: '2026-11-10T10:00:00Z', storage_path: 'p/2' },
  { id: 'a', file_name: 'ITT pack.pdf', file_size: 2 * 1024 * 1024, uploaded_by: 'u1', created_at: '2026-11-06T09:00:00Z', storage_path: 'p/1' },
  { id: 'c', file_name: 'Annex 2 pricing.xlsx', file_size: 21000, uploaded_by: 'u2', created_at: '2026-11-12T09:00:00Z', storage_path: 'p/3' },
];

describe('packageEntries', () => {
  it('numbers files in the order they were added, keeping same-named ones apart', () => {
    expect(packageEntries(files).map((e) => e.zipName)).toEqual(['01 - ITT pack.pdf', '02 - Annex 2 pricing.xlsx', '03 - Annex 2 pricing.xlsx']);
  });

  it('makes names safe for Windows', () => {
    expect(safePart('Bus: Station / "night"?')).toBe('Bus Station night');
    expect(zipFileName('Swansea Bus Station tender', '2026-11-14')).toBe('Swansea Bus Station tender - documents 2026-11-14.zip');
  });
});

describe('contents sheet', () => {
  it('lists the files and, after a check, what is missing', () => {
    const md = contentsMarkdown({
      project: { name: 'Bus Station', clients: { name: 'Council' }, due_date: '2026-11-26' },
      entries: packageEntries(files),
      check: { against: 'the tender pack (ITT pack.pdf)', items: [{ item: 'Annex 3 method statement', status: 'missing', files: [], note: null }, { item: 'Annex 2 pricing', status: 'present', files: ['Annex 2 pricing.xlsx'], note: null }] },
      nameOf: (id) => ({ u1: 'Jess', u2: 'Nikki' }[id]),
      todayLabel: '14 November 2026',
    });
    expect(md).toContain('# Bus Station - documents');
    expect(md).toContain('**01 - ITT pack.pdf** (2.0 MB, added by Jess)');
    expect(md).toContain('1 item not found in the files');
    expect(md).toContain('**MISSING:** Annex 3 method statement');
    expect(md).toMatch(/made by AI/);
  });

  it('makes a real zip with the contents sheet first', async () => {
    const zip = new JSZip();
    zip.file('00 - Contents.docx', await Packer.toBuffer(buildDraftDocx('# X - documents\n\n- **01 - a.pdf**', COMPANY)));
    zip.file('01 - a.pdf', Buffer.from('%PDF-1.4'));
    const back = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(Object.keys(back.files)).toEqual(['00 - Contents.docx', '01 - a.pdf']);
  });
});

describe('cleanCheck', () => {
  it('keeps only real file names and puts missing first', () => {
    const out = cleanCheck({
      against: 'the tender pack (ITT pack.pdf)',
      items: [
        { item: 'Annex 2 pricing', status: 'present', files: ['Annex 2 pricing.xlsx'], note: null },
        { item: 'Insurance certificate', status: 'present', files: ['made-up.pdf'], note: null },
        { item: 'Annex 3', status: 'missing', files: [], note: null },
        { item: '  ', status: 'missing', files: [], note: null },
      ],
    }, files.map((f) => f.file_name));
    expect(out.items.map((i) => [i.item, i.status])).toEqual([
      ['Annex 3', 'missing'],
      ['Insurance certificate', 'unclear'],
      ['Annex 2 pricing', 'present'],
    ]);
    expect(out.items[1].files).toEqual([]);
  });

  it('defaults what it checked against', () => {
    expect(cleanCheck({ items: [] }).against).toBe("the project's tasks");
  });

  it('only allows the three statuses', () => {
    expect(CHECK_SCHEMA.properties.items.items.properties.status.enum).toEqual(['present', 'missing', 'unclear']);
  });
});
