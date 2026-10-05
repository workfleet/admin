import { describe, it, expect } from 'vitest';
import { clearJobSnapshots, loadJobSnapshot, saveJobSnapshot } from '../lib/jobSnapshot';

// The copy of a job the page falls back to with no signal. What matters is
// that it is the right person's, recent, and does not pile up on the phone.

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    _keys: () => [...map.keys()],
  };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T09:00:00Z');

describe('job snapshots', () => {
  it('gives back what was saved', () => {
    const storage = fakeStorage();
    saveJobSnapshot('job-1', 'ann', { job: { id: 'job-1' }, tasks: [{ id: 't' }] }, { storage, now: NOW });
    const snap = loadJobSnapshot('job-1', 'ann', { storage, now: NOW + 1000 });
    expect(snap.job.id).toBe('job-1');
    expect(snap.tasks).toHaveLength(1);
    expect(snap.savedAt).toBe(NOW);
  });

  it('is not shown to somebody else signed in on the same phone', () => {
    const storage = fakeStorage();
    saveJobSnapshot('job-1', 'ann', { job: { id: 'job-1' } }, { storage, now: NOW });
    expect(loadJobSnapshot('job-1', 'bob', { storage, now: NOW })).toBeNull();
  });

  it('is ignored once it is too old to trust', () => {
    const storage = fakeStorage();
    saveJobSnapshot('job-1', 'ann', { job: { id: 'job-1' } }, { storage, now: NOW });
    expect(loadJobSnapshot('job-1', 'ann', { storage, now: NOW + 4 * DAY })).toBeNull();
  });

  it('keeps only the most recent jobs', () => {
    const storage = fakeStorage();
    for (let i = 0; i < 20; i += 1) {
      saveJobSnapshot(`job-${i}`, 'ann', { job: { id: `job-${i}` } }, { storage, now: NOW + i });
    }
    expect(storage._keys()).toHaveLength(15);
    expect(loadJobSnapshot('job-19', 'ann', { storage, now: NOW + 20 })).not.toBeNull();
    expect(loadJobSnapshot('job-0', 'ann', { storage, now: NOW + 20 })).toBeNull();
  });

  it('is wiped on sign-out without touching anything else', () => {
    const storage = fakeStorage();
    storage.setItem('wf.clockQueue', '[]');
    saveJobSnapshot('job-1', 'ann', { job: { id: 'job-1' } }, { storage, now: NOW });
    clearJobSnapshots(storage);
    expect(storage._keys()).toEqual(['wf.clockQueue']);
  });

  it('survives storage that throws', () => {
    const storage = { ...fakeStorage(), setItem: () => { throw new Error('quota'); }, length: 0, key: () => null };
    expect(() => saveJobSnapshot('job-1', 'ann', { job: {} }, { storage, now: NOW })).not.toThrow();
  });
});
