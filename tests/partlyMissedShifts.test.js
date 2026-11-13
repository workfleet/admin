import { describe, it, expect } from 'vitest';
import { partlyMissedShifts } from '../lib/missedClockin';

// A shared visit where one person clocked in and another did not. The job
// completes, so 'missed' never fires for the one who stayed at home.

const job = (overrides = {}) => ({
  id: 'job-1',
  scheduled_at: '2026-11-11T17:00:00.000Z',
  duration_minutes: 120,
  status: 'completed',
  job_assignments: [{ cleaner_id: 'naomi' }, { cleaner_id: 'natasha' }],
  checkins: [{ cleaner_id: 'natasha', checked_in_at: '2026-11-11T17:02:00.000Z' }],
  ...overrides,
});

describe('partlyMissedShifts', () => {
  it('flags the person who did not clock in when a colleague did', () => {
    const result = partlyMissedShifts([job()]);
    expect(result).toHaveLength(1);
    expect(result[0].absent.map((a) => a.cleaner_id)).toEqual(['naomi']);
  });

  it('ignores a job everyone clocked into', () => {
    const j = job({ checkins: [
      { cleaner_id: 'natasha', checked_in_at: '2026-11-11T17:02:00.000Z' },
      { cleaner_id: 'naomi', checked_in_at: '2026-11-11T17:05:00.000Z' },
    ] });
    expect(partlyMissedShifts([j])).toEqual([]);
  });

  it('ignores a completed job with no clock-ins at all - the office recorded it as worked', () => {
    expect(partlyMissedShifts([job({ checkins: [] })])).toEqual([]);
  });

  it('ignores jobs that are not completed', () => {
    expect(partlyMissedShifts([job({ status: 'in_progress' }), job({ status: 'missed' })])).toEqual([]);
  });

  it('a check-in row without a time does not count as clocking in', () => {
    const j = job({ checkins: [
      { cleaner_id: 'natasha', checked_in_at: '2026-11-11T17:02:00.000Z' },
      { cleaner_id: 'naomi', checked_in_at: null },
    ] });
    expect(partlyMissedShifts([j])[0].absent.map((a) => a.cleaner_id)).toEqual(['naomi']);
  });

  it('a reason recorded or an approved claim settles that person only', () => {
    const three = job({ job_assignments: [{ cleaner_id: 'naomi' }, { cleaner_id: 'jane' }, { cleaner_id: 'natasha' }] });
    const outcomes = [{ job_id: 'job-1', cleaner_id: 'naomi', outcome: 'sick' }];
    expect(partlyMissedShifts([three], { outcomes })[0].absent.map((a) => a.cleaner_id)).toEqual(['jane']);
    expect(partlyMissedShifts([three], {
      outcomes,
      claims: [{ job_id: 'job-1', cleaner_id: 'jane', status: 'approved' }],
    })).toEqual([]);
  });

  it('a declined claim does not settle it', () => {
    const claims = [{ job_id: 'job-1', cleaner_id: 'naomi', status: 'declined' }];
    expect(partlyMissedShifts([job()], { claims })).toHaveLength(1);
  });

  it('newest first', () => {
    const older = job({ id: 'a', scheduled_at: '2026-11-04T17:00:00.000Z' });
    const newer = job({ id: 'b', scheduled_at: '2026-11-11T17:00:00.000Z' });
    expect(partlyMissedShifts([older, newer]).map((e) => e.job.id)).toEqual(['b', 'a']);
  });
});
