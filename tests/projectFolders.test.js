import { describe, it, expect } from 'vitest';
import { groupProjectFiles, allFolders, withFolder, withoutFolder, renamedFolder, canonicalFolder, cleanFolderName, UNFILED } from '../lib/projectFolders';
import { describeProjectChange, projectChatContext } from '../lib/projectChat';
import { PROJECT_TEMPLATES } from '../lib/projects';

const files = [
  { id: '1', file_name: 'ITT.pdf', folder: 'Tender pack' },
  { id: '2', file_name: 'Pricing.xlsx', folder: 'pricing' },
  { id: '3', file_name: 'Email.pdf', folder: null },
  { id: '4', file_name: 'Old.docx', folder: 'Archive' },
];

describe('project file folders', () => {
  it('groups by folder in order, matching names whatever the case, loose files last', () => {
    const g = groupProjectFiles(['Tender pack', 'Pricing', 'Our submission'], files);
    expect(g.map((x) => [x.folder, x.files.map((f) => f.id)])).toEqual([
      ['Tender pack', ['1']], ['Pricing', ['2']], ['Our submission', []], ['Archive', ['4']], [UNFILED, ['3']],
    ]);
  });

  it('adds, removes and renames without duplicates', () => {
    expect(withFolder(['Pricing'], ' pricing ')).toEqual(['Pricing']);
    expect(withFolder(['Pricing'], 'Site photos')).toEqual(['Pricing', 'Site photos']);
    expect(withoutFolder(['Pricing', 'Site photos'], 'PRICING')).toEqual(['Site photos']);
    expect(renamedFolder(['Pricing', 'Other'], 'pricing', 'Prices')).toEqual(['Prices', 'Other']);
    expect(allFolders(['Pricing'], files)).toEqual(['Pricing', 'Tender pack', 'Archive']);
  });

  it('keeps the project\'s own spelling and cleans names', () => {
    expect(canonicalFolder(['Tender pack'], 'TENDER PACK')).toBe('Tender pack');
    expect(cleanFolderName('Bids / "2026"?')).toBe('Bids 2026');
  });

  it('starts tenders with the four tender folders', () => {
    expect(PROJECT_TEMPLATES.tender.fileFolders).toEqual(['Tender pack', 'Our submission', 'Pricing', 'Correspondence']);
  });
});

describe('project chat folder changes', () => {
  it('describes adding a folder and moving a file', () => {
    expect(describeProjectChange({ type: 'add_folder', folder: 'Site photos' }).headline).toBe('Add folder: Site photos');
    expect(describeProjectChange({ type: 'move_file', fileName: 'ITT.pdf', fromFolder: null, folder: 'Tender pack', newFolder: true }).details)
      .toEqual(['Not in a folder → Tender pack (new folder)']);
  });

  it('shows the AI each file\'s folder and the folder list', () => {
    const text = projectChatContext({ project: { name: 'X' }, files: [{ id: 'f1', file_name: 'ITT.pdf', folder: 'Tender pack' }], folders: ['Tender pack', 'Pricing'], today: '2026-11-15' });
    expect(text).toContain('- f1 | Tender pack | ITT.pdf');
    expect(text).toContain('Folders: Tender pack, Pricing');
  });
});
