import { describe, it, expect } from 'vitest';
import {
  addDays,
  buildFromTemplate,
  taskProgress,
  nextDeadline,
  overdueTaskCount,
  daysUntil,
  describeDaysUntil,
  PROJECT_TEMPLATES,
  PROJECT_KINDS,
  isOpenStatus,
} from '../lib/projects';

describe('addDays', () => {
  it('counts back across a month end', () => {
    expect(addDays('2026-12-01', -7)).toBe('2026-11-24');
  });

  it('is not moved by the October clock change', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('gives null without a date', () => {
    expect(addDays('', 3)).toBeNull();
    expect(addDays(null, 3)).toBeNull();
  });
});

describe('buildFromTemplate', () => {
  it('dates the tender tasks back from the submission deadline', () => {
    const { tasks, dates } = buildFromTemplate('tender', '2026-11-26');
    expect(tasks[0].due_date).toBe('2026-11-05');
    expect(tasks.at(-1).due_date).toBe('2026-11-25');
    expect(dates).toEqual([
      { label: 'Clarification questions close', date: '2026-11-19' },
      { label: 'Submission deadline', date: '2026-11-26' },
    ]);
  });

  it('keeps the tasks but drops key dates when there is no target date', () => {
    const { tasks, dates } = buildFromTemplate('deep_clean', '');
    expect(tasks.length).toBe(PROJECT_TEMPLATES.deep_clean.tasks.length);
    expect(tasks.every((t) => t.due_date === null)).toBe(true);
    expect(dates).toEqual([]);
  });

  it('numbers tasks in template order', () => {
    const { tasks } = buildFromTemplate('contract_start', '2027-01-03');
    expect(tasks.map((t) => t.position)).toEqual(tasks.map((_, i) => i));
  });

  it('starts internal projects empty', () => {
    expect(buildFromTemplate('internal', '2026-12-01')).toEqual({ tasks: [], dates: [] });
  });

  it('has a template for every kind', () => {
    PROJECT_KINDS.forEach((k) => expect(PROJECT_TEMPLATES[k.value]).toBeTruthy());
  });
});

describe('taskProgress', () => {
  it('counts done tasks', () => {
    expect(taskProgress([{ status: 'done' }, { status: 'to_do' }, { status: 'in_progress' }, { status: 'done' }]))
      .toEqual({ done: 2, total: 4, percent: 50 });
  });

  it('is zero for no tasks', () => {
    expect(taskProgress([])).toEqual({ done: 0, total: 0, percent: 0 });
  });
});

describe('nextDeadline', () => {
  const today = '2026-11-14';

  it('picks the soonest open date or task', () => {
    const next = nextDeadline({
      dates: [{ label: 'Submit', date: '2026-11-26', done: false }],
      tasks: [
        { title: 'Pricing', due_date: '2026-11-20', status: 'to_do' },
        { title: 'Read pack', due_date: '2026-11-10', status: 'done' },
      ],
    }, today);
    expect(next).toEqual({ label: 'Pricing', date: '2026-11-20', type: 'task', overdue: false });
  });

  it('puts a late item first and flags it', () => {
    const next = nextDeadline({ tasks: [{ title: 'Site visit', due_date: '2026-11-12', status: 'in_progress' }] }, today);
    expect(next.overdue).toBe(true);
  });

  it('ignores ticked dates', () => {
    expect(nextDeadline({ dates: [{ label: 'Q', date: '2026-11-19', done: true }] }, today)).toBeNull();
  });

  it('prefers the key date when a task falls on the same day', () => {
    const next = nextDeadline({
      dates: [{ label: 'Submit', date: '2026-11-26', done: false }],
      tasks: [{ title: 'Upload', due_date: '2026-11-26', status: 'to_do' }],
    }, today);
    expect(next.type).toBe('date');
  });
});

describe('overdue and days', () => {
  it('counts unfinished late tasks only', () => {
    expect(overdueTaskCount([
      { status: 'to_do', due_date: '2026-11-01' },
      { status: 'done', due_date: '2026-11-01' },
      { status: 'to_do', due_date: '2026-11-14' },
      { status: 'to_do', due_date: null },
    ], '2026-11-14')).toBe(1);
  });

  it('describes distance in days', () => {
    expect(daysUntil('2026-11-26', '2026-11-14')).toBe(12);
    expect(describeDaysUntil('2026-11-15', '2026-11-14')).toBe('tomorrow');
    expect(describeDaysUntil('2026-11-11', '2026-11-14')).toBe('3 days ago');
    expect(describeDaysUntil('2026-11-14', '2026-11-14')).toBe('today');
  });

  it('treats planning, active and on hold as open', () => {
    expect(['planning', 'active', 'on_hold', 'done', 'cancelled'].map(isOpenStatus))
      .toEqual([true, true, true, false, false]);
  });
});
