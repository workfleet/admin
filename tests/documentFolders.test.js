import { describe, it, expect } from 'vitest';
import { groupByFolder, matchesSearch, reorder, cleanSortSuggestions, sortRequestText, UNSORTED, SORT_SCHEMA } from '../lib/documentFolders';

const folders = [
  { id: 'pol', name: 'Policies', category: 'policy', position: 10 },
  { id: 'ins', name: 'Insurance', category: 'other', position: 20 },
  { id: 'con', name: 'Contracts', category: 'contract', position: 30 },
];
const docs = [
  { id: '1', title: 'Lone working policy', file_name: 'lone.docx', folder_id: 'pol' },
  { id: '2', title: 'PL certificate 2026', file_name: 'pl.pdf', folder_id: 'pol' },
  { id: '3', title: 'Worker Contract - A', file_name: 'a.pdf', folder_id: 'con' },
  { id: '4', title: 'Old thing', file_name: 'x.pdf', folder_id: null },
];

describe('groupByFolder', () => {
  it('keeps folder order, shows empty folders, and puts loose ones in Unsorted', () => {
    const g = groupByFolder(folders, docs);
    expect(g.map((x) => [x.folder.name, x.docs.length])).toEqual([['Policies', 2], ['Insurance', 0], ['Contracts', 1], ['Unsorted', 1]]);
    expect(g.at(-1).folder.id).toBe(UNSORTED);
  });

  it('can hide empty folders (while searching, and for cleaners)', () => {
    expect(groupByFolder(folders, docs, { keepEmpty: false }).map((x) => x.folder.name)).toEqual(['Policies', 'Contracts', 'Unsorted']);
  });
});

describe('search and order', () => {
  it('matches title, file name or folder', () => {
    expect(matchesSearch(docs[0], 'Policies', 'lone')).toBe(true);
    expect(matchesSearch(docs[1], 'Insurance', 'insur')).toBe(true);
    expect(matchesSearch(docs[1], 'Policies', 'zzz')).toBe(false);
    expect(matchesSearch(docs[1], 'Policies', '')).toBe(true);
  });

  it('swaps a folder with its neighbour and only saves what changed', () => {
    expect(reorder(folders, 'ins', -1)).toEqual([{ id: 'ins', position: 10 }, { id: 'pol', position: 20 }]);
    expect(reorder(folders, 'pol', -1)).toEqual([]);
  });
});

describe('AI sort suggestions', () => {
  it('keeps real moves only and never moves anything out of Contracts', () => {
    const out = cleanSortSuggestions({
      documents: [
        { id: '2', folder_id: 'ins', reason: 'Insurance certificate' },
        { id: '1', folder_id: 'pol', reason: 'Already there' },
        { id: '3', folder_id: 'pol', reason: 'Looks like a policy' },
        { id: '4', folder_id: 'made-up', reason: '?' },
        { id: '99', folder_id: 'ins', reason: '?' },
        { id: '2', folder_id: 'pol', reason: 'duplicate' },
      ],
    }, folders, docs);
    expect(out).toEqual([{ id: '2', title: 'PL certificate 2026', from_folder_id: 'pol', folder_id: 'ins', reason: 'Insurance certificate' }]);
  });

  it('gives the AI folder and document ids to choose from', () => {
    const t = sortRequestText(folders, docs);
    expect(t).toContain('- ins: Insurance');
    expect(t).toContain('- 4 | Old thing | x.pdf | none');
    expect(SORT_SCHEMA.required).toEqual(['documents']);
  });
});
