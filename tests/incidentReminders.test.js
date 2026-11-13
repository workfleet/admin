import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { dueReminders } from '../lib/incidentReminders';
import { todoList } from '../lib/incidents';
import { RIGHT_NOW, FIRST_AID_CARDS } from '../lib/safetyGuidance';
import SafetyGuidance from '../app/components/SafetyGuidance';

// Accident 1 Sep 2026 (a Tuesday), reported the same morning.
const report = (over) => ({
  id: 'r1', kind: 'accident', status: 'investigating', occurred_at: '2026-09-01T09:00:00Z', created_at: '2026-09-01T10:00:00Z',
  location: 'Axis Court, stairs', injured_party: 'me', injured_status: 'employee', treatment: 'first_aid',
  off_work: false, back_at_work_on: null, riddor_category: 'not_reportable', riddor_reported_on: null,
  reporter: { full_name: 'Sam Jones' }, ...over,
});
const keys = (reports, today) => dueReminders(reports, today).map((d) => d.key);

describe('dueReminders', () => {
  it('sends nothing for a fresh, decided report, or a closed one', () => {
    expect(keys([report()], '2026-09-02')).toEqual([]);
    expect(keys([report({ status: 'closed', riddor_category: null })], '2026-10-30')).toEqual([]);
  });

  it('asks for the HSE decision from the day after it was reported', () => {
    expect(keys([report({ riddor_category: null })], '2026-09-01')).toEqual([]);
    expect(keys([report({ riddor_category: null })], '2026-09-02')).toEqual(['hse_decide']);
  });

  it('warns three days before an HSE deadline, then when it is overdue', () => {
    const r = report({ riddor_category: 'specified_injury' }); // due 11 Sep
    expect(keys([r], '2026-09-07')).toEqual([]);
    expect(keys([r], '2026-09-08')).toEqual(['hse_due:2026-09-11', 'open_7']);
    expect(keys([r], '2026-09-12')).toEqual(['hse_overdue:2026-09-11', 'open_7']);
    expect(keys([{ ...r, riddor_reported_on: '2026-09-02' }], '2026-09-12')).toEqual(['open_7']);
  });

  it('flags a record-only injury once the time off passes 7 days', () => {
    const r = report({ riddor_category: 'over_3_day_record_only', off_work: true });
    expect(keys([r], '2026-09-06')).toEqual([]);
    expect(keys([r], '2026-09-09')).toEqual(['hse_decide_over7:2026-09-16', 'open_7', 'still_off:1']);
  });

  it('reminds weekly while someone is still off, and stops when they are back', () => {
    const r = report({ off_work: true, riddor_category: 'over_7_day', riddor_reported_on: '2026-09-10' });
    expect(keys([r], '2026-09-15')).toContain('still_off:2');
    expect(dueReminders([r], '2026-09-15').find((d) => d.key === 'still_off:2').message).toMatch(/^Accident book: Sam Jones has been off 14 days/);
    expect(keys([{ ...r, back_at_work_on: '2026-09-14' }], '2026-09-15')).not.toContain('still_off:2');
  });

  it('nudges a report left open for a week, then a month', () => {
    expect(keys([report({ kind: 'near_miss', injured_party: null, riddor_category: null })], '2026-09-08')).toEqual(['open_7']);
    expect(keys([report({ kind: 'near_miss', injured_party: null, riddor_category: null })], '2026-10-01')).toEqual(['open_30']);
  });
});

describe('site warnings on the to-do list', () => {
  it('appears only where the page knows the count, and is recommended', () => {
    expect(todoList(report()).some((i) => i.key === 'warn')).toBe(false);
    expect(todoList({ ...report(), site_warning_count: 0 }).find((i) => i.key === 'warn')).toMatchObject({ done: false, required: false });
    expect(todoList({ ...report(), site_warning_count: 1 }).find((i) => i.key === 'warn').done).toBe(true);
  });
});

describe('SafetyGuidance', () => {
  it('renders the steps, every card, and the call buttons', () => {
    const html = renderToStaticMarkup(createElement(SafetyGuidance, { officePhone: '07350 136763' }));
    for (const step of RIGHT_NOW) expect(html).toContain(step.title);
    for (const card of FIRST_AID_CARDS) expect(html).toContain(card.title);
    expect(html).toContain('href="tel:999"');
    expect(html).toContain('href="tel:07350136763"');
    expect(renderToStaticMarkup(createElement(SafetyGuidance, {}))).not.toContain('Office');
  });
});
