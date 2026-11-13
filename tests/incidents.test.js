import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildIncidentRow, riddorPrompts, needsRiddorDecision, incidentSummary, csvRow, CSV_COLUMNS,
  daysOffWork, riddorState, riddorDeadline, closeProblems, accidentBookGaps, hseSummary,
} from '../lib/incidents';
import { COMPANY } from '../lib/companyBranding';
import { toCSV } from '../lib/csv';
import IncidentDetails from '../app/components/IncidentDetails';

// The form's rules must match 0130's check constraint, or a report someone
// typed out at the scene is thrown back with a Postgres error.

const now = new Date('2026-09-26T12:00:00Z');
const base = {
  kind: 'accident',
  occurredAt: '2026-09-26T10:30',
  location: '12 High Street, kitchen',
  description: 'Slipped on the wet floor',
  injuredParty: 'me',
  treatment: 'first_aid',
  injuryDetails: 'Bruised hip',
};
const build = (form) => buildIncidentRow(form, { reporterId: 'u1', now });

describe('buildIncidentRow', () => {
  it('builds an accident to yourself without asking for your name', () => {
    const { errors, row } = build(base);
    expect(errors).toEqual([]);
    expect(row).toMatchObject({ reported_by: 'u1', kind: 'accident', injured_party: 'me', injured_name: null, treatment: 'first_aid' });
  });

  it('strips the injury fields off a near miss, so the constraint holds', () => {
    const { errors, row } = build({ ...base, kind: 'near_miss', injuredName: 'Sam', damageDetails: 'vase' });
    expect(errors).toEqual([]);
    expect(row.injured_party).toBeNull();
    expect(row.treatment).toBeNull();
    expect(row.injury_details).toBeNull();
    expect(row.damage_details).toBeNull();
  });

  it('a damage-only accident has no treatment and must say what broke', () => {
    expect(build({ ...base, injuredParty: 'nobody' }).errors).toContain('Say what was damaged.');
    const { row } = build({ ...base, injuredParty: 'nobody', damageDetails: 'Glass vase' });
    expect(row.treatment).toBeNull();
    expect(row.injury_details).toBeNull();
  });

  it('asks for the name when someone else was hurt', () => {
    expect(build({ ...base, injuredParty: 'client' }).errors).toContain('Give the name of the person who was hurt.');
  });

  it('asks for treatment and the injury when someone was hurt', () => {
    const { errors } = build({ ...base, treatment: '', injuryDetails: ' ' });
    expect(errors).toContain('Say what treatment they had.');
    expect(errors).toContain('Describe the injury.');
  });

  it('refuses a time in the future and a blank description', () => {
    const { errors } = build({ ...base, occurredAt: '2026-09-27T10:00', description: '   ' });
    expect(errors).toContain('The time it happened is in the future.');
    expect(errors).toContain('Say what happened.');
  });
});

const accident = (over) => ({
  kind: 'accident', occurred_at: '2026-09-01T09:00:00Z', injured_party: 'me', treatment: 'first_aid',
  injured_status: 'employee', off_work: false, back_at_work_on: null, riddor_category: null, ...over,
});

describe('daysOffWork', () => {
  it('does not count the day of the accident, and counts weekends', () => {
    // Tue 1 Sep, back Mon 7 Sep: off Wed-Sun = 5 days.
    expect(daysOffWork(accident({ off_work: true, back_at_work_on: '2026-09-07' }))).toBe(5);
  });

  it('counts up to today while they are still off', () => {
    expect(daysOffWork(accident({ off_work: true }), '2026-09-09')).toBe(8);
    expect(daysOffWork(accident(), '2026-09-09')).toBe(0);
  });

  it('uses the London date, not UTC, for a late-evening accident', () => {
    // 23:30 UTC on 1 Sep is 00:30 BST on 2 Sep.
    expect(daysOffWork(accident({ occurred_at: '2026-09-01T23:30:00Z', off_work: true, back_at_work_on: '2026-09-04' }))).toBe(1);
  });
});

describe('riddorPrompts', () => {
  it('says nothing for a near miss or a first-aid bump', () => {
    expect(riddorPrompts({ kind: 'near_miss' })).toEqual([]);
    expect(riddorPrompts(accident(), '2026-09-10')).toEqual([]);
  });

  it('gives the 15-day deadline once a worker is off more than 7 days', () => {
    const [p] = riddorPrompts(accident({ off_work: true, back_at_work_on: '2026-09-10' }), '2026-09-12');
    expect(p.key).toBe('over7');
    expect(p.due).toBe('2026-09-16');
  });

  it('warns while still off when it will become reportable', () => {
    const [p] = riddorPrompts(accident({ off_work: true }), '2026-09-06');
    expect(p.key).toBe('over3');
    expect(p.text).toMatch(/still off on Wed,? 9 Sept? 2026, it becomes reportable/);
  });

  it('treats hospital differently for a worker and for the public', () => {
    expect(riddorPrompts(accident({ treatment: 'hospital' })).map((p) => p.key)).toEqual(['specified']);
    expect(riddorPrompts(accident({ injured_party: 'public', injured_status: 'non_worker', injured_name: 'X', treatment: 'hospital' })).map((p) => p.key)).toEqual(['public_hospital']);
  });

  it('tells the office a subcontractor is usually reported by the client', () => {
    expect(riddorPrompts(accident({ injured_status: 'self_employed' })).map((p) => p.key)).toContain('self_employed');
  });

  it('mentions occupational disease for chemical contact', () => {
    expect(riddorPrompts(accident({ accident_kind: 'harmful_substance' })).map((p) => p.key)).toContain('disease');
  });
});

describe('riddorState', () => {
  it('flags every undecided injury, and nothing for a near miss', () => {
    expect(riddorState(accident(), '2026-09-02').state).toBe('decide');
    expect(riddorState({ kind: 'near_miss' }, '2026-09-02').state).toBe('none');
    expect(needsRiddorDecision(accident({ riddor_category: 'not_reportable' }), '2026-09-02')).toBe(false);
  });

  it('has a deadline once reportable, and goes overdue after it', () => {
    const specified = accident({ treatment: 'hospital', riddor_category: 'specified_injury' });
    expect(riddorDeadline(specified)).toEqual({ immediate: true, due: '2026-09-11' });
    expect(riddorState(specified, '2026-09-05')).toMatchObject({ state: 'due', due: '2026-09-11' });
    expect(riddorState(specified, '2026-09-12').state).toBe('overdue');
    expect(riddorState({ ...specified, riddor_reported_on: '2026-09-01' }, '2026-09-12').state).toBe('reported');
  });

  it('reopens the question when "record only" runs past 7 days off', () => {
    const r = accident({ riddor_category: 'over_3_day_record_only', off_work: true });
    expect(riddorState(r, '2026-09-06').state).toBe('none');
    expect(riddorState(r, '2026-09-10')).toMatchObject({ state: 'decide', due: '2026-09-16' });
  });
});

describe('closeProblems', () => {
  const ready = accident({
    injured_address: '1 Road', injured_occupation: 'Cleaning Operative', riddor_category: 'not_reportable', corrective_action: 'Mats replaced',
  });

  it('lets a complete report close', () => {
    expect(closeProblems(ready)).toEqual([]);
    expect(closeProblems({ kind: 'near_miss', corrective_action: 'Cable moved' })).toEqual([]);
  });

  it('needs the accident book details, a category, and the HSE reference', () => {
    expect(closeProblems({ ...ready, injured_address: null })[0]).toContain('address');
    expect(closeProblems({ ...ready, riddor_category: null })[0]).toContain('RIDDOR category');
    expect(closeProblems({ ...ready, riddor_category: 'over_7_day' })[0]).toContain('HSE');
    expect(closeProblems({ ...ready, riddor_category: 'over_7_day', riddor_reported_on: '2026-09-10', riddor_reference: 'ABC123' })).toEqual([]);
    expect(closeProblems({ ...ready, off_work: true })[0]).toContain('went back');
  });

  it('accident book gaps name the injured person for anyone but the reporter', () => {
    expect(accidentBookGaps({ ...ready, injured_party: 'client', injured_name: null })).toContain("the injured person's name");
  });
});

const fullReport = {
  id: 'r1', kind: 'accident', occurred_at: '2026-09-26T09:30:00Z', created_at: '2026-09-26T10:00:00Z',
  location: '12 High Street', description: 'Cut hand on broken glass, "deep"', injured_party: 'client',
  injured_name: 'Mrs Patel', injury_details: 'Cut palm', treatment: 'gp', damage_details: null,
  immediate_action: 'Cleaned and covered', witnesses: null, photo_paths: ['u1/a.jpg'], status: 'open',
  injured_address: '3 Mill Lane', injured_occupation: 'Retired', injured_status: 'non_worker',
  accident_kind: 'hit_fixed_object', body_part: 'Right palm', off_work: false,
  riddor_category: null, reporter: { full_name: 'Sam Jones' }, jobs: { properties: { address: '12 High Street' } },
};

describe('display and export', () => {
  it('summarises who was hurt', () => {
    expect(incidentSummary(fullReport)).toBe('Mrs Patel hurt - gp, walk-in or minor injuries');
    expect(incidentSummary({ kind: 'near_miss' })).toBe('Near miss - nobody hurt');
  });

  it('lays out the HSE summary in the form\'s order', () => {
    const text = hseSummary({ ...fullReport, riddor_category: 'non_worker_hospital' }, COMPANY, '2026-09-27');
    expect(text).toContain(`Organisation: ${COMPANY.legalName}`);
    expect(text).toContain('Kind of accident: Hit something fixed or stationary');
    expect(text).toContain('Name: Mrs Patel');
    expect(text).toContain('Address: 3 Mill Lane');
    expect(text).toContain('Time: 10:30');
    expect(text.indexOf('ABOUT THE INCIDENT')).toBeLessThan(text.indexOf('THE INJURED PERSON'));
  });

  it('exports every column, quoting free text', () => {
    const csv = toCSV(CSV_COLUMNS, [csvRow(fullReport)]);
    expect(csv.split('\n')[0].split(',').length).toBe(CSV_COLUMNS.length);
    expect(csv).toContain('"Cut hand on broken glass, ""deep"""');
    expect(csv).toContain('Not decided');
  });

  // The build never runs a component body; this does, with the shape the
  // pages select.
  it('renders a report without crashing', () => {
    const html = renderToStaticMarkup(createElement(IncidentDetails, { report: { ...fullReport, recorded_by_occupation: 'Cleaning Operative' }, photoUrls: ['https://x/signed'] }));
    expect(html).toContain('Mrs Patel');
    expect(html).toContain('3 Mill Lane');
    expect(html).toContain('Cleaning Operative');
    expect(html).toContain('Sam Jones');
    expect(html).toContain('https://x/signed');
    const nearMiss = renderToStaticMarkup(createElement(IncidentDetails, {
      report: { ...fullReport, kind: 'near_miss', injured_party: null, treatment: null, injury_details: null, jobs: null, reporter: null },
    }));
    expect(nearMiss).not.toContain('Who was hurt');
  });
});
