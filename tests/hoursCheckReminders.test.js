import { describe, it, expect } from 'vitest';
import {
  MESSAGE_PREFIX,
  hoursCheckReminders,
  pushFor,
  reminderMessage,
  siteName,
} from '../lib/hoursCheckReminders';

// The morning-after "you didn't clock in - did you work it?" reminder. The
// failure that matters is sending someone to a claim form the database will
// refuse, or nagging about a shift the office has already settled.

const now = new Date('2026-11-19T08:00:00Z');
const job = (overrides = {}) => ({
  id: 'job-1',
  status: 'missed',
  scheduled_at: '2026-11-18T09:00:00Z',
  duration_minutes: 120,
  properties: { address: 'Water Street, Carmarthen', clients: { name: 'Cartrefi Cymru' } },
  job_assignments: [{ cleaner_id: 'a' }, { cleaner_id: 'b' }],
  ...overrides,
});
const run = (over = {}) => hoursCheckReminders({ jobs: [job()], recipients: ['a', 'b'], now, ...over });

describe('hoursCheckReminders', () => {
  it('reminds everyone on a shift nobody clocked into', () => {
    expect(run().map((r) => r.cleanerId)).toEqual(['a', 'b']);
  });

  it('also catches a shift still at scheduled whose time has run out', () => {
    // reconcile only marks 'missed' when an admin opens the rota.
    expect(run({ jobs: [job({ status: 'scheduled' })] })).toHaveLength(2);
  });

  it('leaves a shift alone while it could still be clocked into', () => {
    // Flexible start (0146): 23:00 booking, startable until 03:00, 3 hours.
    const night = job({ status: 'scheduled', scheduled_at: '2026-11-19T05:00:00Z', start_window_minutes: 240, duration_minutes: 180 });
    expect(run({ jobs: [night] })).toEqual([]);
  });

  it('skips anyone with a claim in, a recorded outcome, or a reminder already sent', () => {
    expect(run({ claims: [{ job_id: 'job-1', cleaner_id: 'a', status: 'pending' }] }).map((r) => r.cleanerId)).toEqual(['b']);
    expect(run({ outcomes: [{ job_id: 'job-1', cleaner_id: 'b' }] }).map((r) => r.cleanerId)).toEqual(['a']);
    expect(run({ alreadyTold: [{ job_id: 'job-1', user_id: 'a' }, { job_id: 'job-1', user_id: 'b' }] })).toEqual([]);
  });

  it('does not ask again after the office declined a claim', () => {
    expect(run({ claims: [{ job_id: 'job-1', cleaner_id: 'a', status: 'declined' }] }).map((r) => r.cleanerId)).toEqual(['b']);
  });

  it('only messages active staff, and only for the last week', () => {
    expect(run({ recipients: ['b'] }).map((r) => r.cleanerId)).toEqual(['b']);
    expect(run({ jobs: [job({ scheduled_at: '2026-11-10T09:00:00Z' })] })).toEqual([]);
  });

  it('ignores worked and cancelled shifts', () => {
    expect(run({ jobs: [job({ status: 'completed' }), job({ id: 'job-2', status: 'cancelled' })] })).toEqual([]);
  });
});

describe('wording', () => {
  it('names the client, London day and time, and the button to press', () => {
    const msg = reminderMessage(job({ scheduled_at: '2026-11-18T23:00:00Z' }));
    expect(msg.startsWith(MESSAGE_PREFIX)).toBe(true);
    expect(msg).toContain('Cartrefi Cymru on Wed 18 Nov 23:00');
    expect(msg).toContain('I worked this');
  });

  it('falls back to the first part of the address', () => {
    expect(siteName({ properties: { address: 'Clyne Court (SE), Parkway, Sketty' } })).toBe('Clyne Court (SE)');
  });

  it('one shift opens that shift; several open My Hours', () => {
    expect(pushFor([{ job: job() }]).url).toBe('/cleaner/jobs/job-1');
    const several = pushFor([{ job: job() }, { job: job({ id: 'job-2' }) }]);
    expect(several.url).toBe('/cleaner/hours');
    expect(several.title).toBe('2 shifts with no hours');
  });
});
