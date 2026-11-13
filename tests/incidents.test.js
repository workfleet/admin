import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildIncidentRow, incidentSummary, csvRow, CSV_COLUMNS,
  daysOffWork, riddorState, riddorDeadline, needsRiddorDecision, closeProblems, accidentBookGaps, hseSummary,
  todoList, hseQuestions, answersFromReport, riddorFromAnswers, hseOutcome, hseNotes,
} from '../lib/incidents';
import { COMPANY } from '../lib/companyBranding';
import { toCSV } from '../lib/csv';
import IncidentDetails from '../app/components/IncidentDetails';

vi.mock('../lib/supabaseClient', () => ({ supabase: {} }));
vi.mock('../app/components/ToastProvider', () => ({ useToast: () => ({ success() {}, error() {} }) }));

// The form's rules must match the table's check constraints (0117, 0130,
// 0131), or a report someone typed out at the scene is thrown back with a
// Postgres error.

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
const build = (form, opts = {}) => buildIncidentRow(form, { reporterId: 'u1', now, ...opts });

describe('buildIncidentRow', () => {
  it('builds an accident to yourself without asking for your name', () => {
    const { errors, row } = build(base);
    expect(errors).toEqual([]);
    expect(row).toMatchObject({ reported_by: 'u1', kind: 'accident', injured_party: 'me', injured_name: null, treatment: 'first_aid', incident_type: null });
  });

  it('strips the injury fields off a near miss, so the constraint holds', () => {
    const { errors, row } = build({ ...base, kind: 'near_miss', injuredName: 'Sam', damageDetails: 'vase' });
    expect(errors).toEqual([]);
    expect(row.injured_party).toBeNull();
    expect(row.treatment).toBeNull();
    expect(row.injury_details).toBeNull();
    expect(row.damage_details).toBeNull();
  });

  it('an incident needs its type, has no injury part, and keeps the damage', () => {
    expect(build({ ...base, kind: 'incident' }).errors).toContain('Say what kind of incident it was.');
    const { errors, row } = build({ ...base, kind: 'incident', incidentType: 'damage', damageDetails: 'Glass vase' });
    expect(errors).toEqual([]);
    expect(row).toMatchObject({ kind: 'incident', incident_type: 'damage', injured_party: null, treatment: null, damage_details: 'Glass vase' });
  });

  it('no longer offers "nobody hurt" on an accident - that is an incident now', () => {
    expect(build({ ...base, injuredParty: 'nobody' }).errors).toContain('Say who was hurt.');
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

  it('keeps "told by" only when the office adds the report', () => {
    expect(build({ ...base, toldBy: 'Sarah rang' }).row.told_by).toBeNull();
    expect(build({ ...base, toldBy: 'Sarah rang' }, { office: true }).row.told_by).toBe('Sarah rang');
  });

  it('lets the office copy in an old paper entry', () => {
    expect(build({ ...base, occurredAt: '2024-03-01T09:00' }, { office: true }).errors).toEqual([]);
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

describe('the HSE questions', () => {
  it('asks a worker about death, serious injury and illness; a non-worker about hospital', () => {
    expect(hseQuestions(accident()).map((q) => q.key)).toEqual(['died', 'serious', 'disease']);
    expect(hseQuestions(accident({ injured_party: 'public', injured_status: 'non_worker' })).map((q) => q.key)).toEqual(['died', 'hospital']);
    expect(hseQuestions({ kind: 'incident', incident_type: 'spill_fire_flood' }).map((q) => q.key)).toEqual(['dangerous']);
  });

  it('waits for the answers before deciding', () => {
    expect(riddorFromAnswers(accident(), {}, '2026-09-02')).toBeNull();
    expect(riddorFromAnswers(accident(), { died: 'no' }, '2026-09-02')).toBeNull();
  });

  it('works out the category from the answers and the time off', () => {
    const no = { died: 'no', serious: 'no' };
    expect(riddorFromAnswers(accident(), no, '2026-09-02')).toBe('not_reportable');
    expect(riddorFromAnswers(accident(), { died: 'no', serious: 'yes' })).toBe('specified_injury');
    expect(riddorFromAnswers(accident({ off_work: true }), no, '2026-09-06')).toBe('over_3_day_record_only');
    expect(riddorFromAnswers(accident({ off_work: true }), no, '2026-09-10')).toBe('over_7_day');
    expect(riddorFromAnswers(accident({ injured_party: 'public', injured_status: 'non_worker' }), { died: 'no', hospital: 'yes' })).toBe('non_worker_hospital');
    expect(riddorFromAnswers({ kind: 'incident', incident_type: 'spill_fire_flood' }, { dangerous: 'yes' })).toBe('dangerous_occurrence');
    expect(riddorFromAnswers({ kind: 'incident', incident_type: 'damage' }, { dangerous: 'no' })).toBeNull();
  });

  it('reopens a saved report with the questions answered as they were', () => {
    for (const category of ['death', 'specified_injury', 'not_reportable']) {
      const r = accident({ riddor_category: category });
      expect(riddorFromAnswers(r, answersFromReport(r), '2026-09-02')).toBe(category);
    }
  });

  it('says in plain words what to do', () => {
    expect(hseOutcome(accident(), '2026-09-02').text).toMatch(/Answer the questions/);
    expect(hseOutcome(accident({ riddor_category: 'not_reportable' }), '2026-09-02').text).toMatch(/^No, HSE does not need to know/);
    const specified = hseOutcome(accident({ riddor_category: 'specified_injury' }), '2026-09-02');
    expect(specified.tone).toBe('urgent');
    expect(specified.text).toMatch(/Report it to HSE now/);
    expect(specified.text).toContain('0345 300 9923');
    expect(hseOutcome(accident({ riddor_category: 'over_7_day', riddor_reported_on: '2026-09-10', riddor_reference: 'AB1' })).text).toContain('reference AB1');
    expect(hseOutcome({ kind: 'incident', incident_type: 'damage', occurred_at: '2026-09-01T09:00:00Z' })).toBeNull();
  });

  it('warns about subcontractors and chemicals', () => {
    expect(hseNotes(accident({ injured_status: 'self_employed' }))[0]).toMatch(/usually the client/);
    expect(hseNotes({ kind: 'incident', incident_type: 'spill_fire_flood' })[0]).toMatch(/dermatitis/);
  });
});

describe('time off', () => {
  it('says when a record-only injury becomes reportable while they are still off', () => {
    const text = hseOutcome(accident({ off_work: true, riddor_category: 'over_3_day_record_only' }), '2026-09-06').text;
    expect(text).toMatch(/still off on Wed,? 9 Sept? 2026, report it by Wed,? 16 Sept? 2026/);
  });

  it('gives the 15-day deadline once it is over 7 days', () => {
    expect(hseOutcome(accident({ off_work: true, back_at_work_on: '2026-09-10', riddor_category: 'over_7_day' })).text)
      .toMatch(/by Wed,? 16 Sept? 2026/);
  });
});

describe('riddorState', () => {
  it('flags every undecided injury, and nothing for a near miss or incident', () => {
    expect(riddorState(accident(), '2026-09-02').state).toBe('decide');
    expect(riddorState({ kind: 'near_miss' }, '2026-09-02').state).toBe('none');
    expect(riddorState({ kind: 'incident', incident_type: 'damage' }, '2026-09-02').state).toBe('none');
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

describe('the to-do list', () => {
  const ready = accident({
    injured_address: '1 Road', injured_occupation: 'Cleaning Operative', riddor_category: 'not_reportable', corrective_action: 'Mats replaced',
  });

  it('lets a complete report close', () => {
    expect(closeProblems(ready, '2026-09-02')).toEqual([]);
    expect(closeProblems({ kind: 'near_miss', corrective_action: 'Cable moved' })).toEqual([]);
    expect(closeProblems({ kind: 'incident', incident_type: 'keys_or_access', corrective_action: 'Key safe fitted' })).toEqual([]);
  });

  it('needs the accident book details, the HSE answer, and the HSE reference', () => {
    expect(closeProblems({ ...ready, injured_address: null }, '2026-09-02')[0]).toContain('address');
    expect(closeProblems({ ...ready, riddor_category: null }, '2026-09-02')[0]).toContain('HSE needs to know');
    expect(closeProblems({ ...ready, riddor_category: 'over_7_day' }, '2026-09-02')[0]).toContain('Report it to HSE');
    expect(closeProblems({ ...ready, riddor_category: 'over_7_day', riddor_reported_on: '2026-09-10', riddor_reference: 'ABC123' }, '2026-09-02')).toEqual([]);
    expect(closeProblems({ ...ready, off_work: true }, '2026-09-02')[0]).toContain('went back');
    expect(closeProblems({ ...ready, corrective_action: '' }, '2026-09-02')[0]).toContain("doesn't happen again");
  });

  it('marks the insurer and client as recommended, not required', () => {
    const items = todoList({ ...ready, job_id: 'j1' }, '2026-09-02');
    expect(items.find((i) => i.key === 'insurer')).toMatchObject({ required: false, done: false });
    expect(items.find((i) => i.key === 'client')).toMatchObject({ required: false, done: false });
    expect(todoList({ kind: 'near_miss' }).some((i) => i.key === 'insurer')).toBe(false);
  });

  it('accident book gaps name the injured person for anyone but the reporter', () => {
    expect(accidentBookGaps({ ...ready, injured_party: 'client', injured_name: null })).toContain('name');
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
  it('summarises who was hurt, or what kind of incident', () => {
    expect(incidentSummary(fullReport)).toBe('Mrs Patel hurt - gp, walk-in or minor injuries');
    expect(incidentSummary({ kind: 'near_miss' })).toBe('Near miss - nobody hurt');
    expect(incidentSummary({ kind: 'incident', incident_type: 'keys_or_access' })).toBe('Keys, codes or alarm problem');
  });

  it("lays out the HSE summary in the form's order", () => {
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

  // The build never runs a component body; these do, with the shape the
  // pages select.
  it('renders a report without crashing', () => {
    const html = renderToStaticMarkup(createElement(IncidentDetails, { report: { ...fullReport, recorded_by_occupation: 'Cleaning Operative' }, photoUrls: ['https://x/signed'] }));
    expect(html).toContain('Mrs Patel');
    expect(html).toContain('3 Mill Lane');
    expect(html).toContain('Cleaning Operative');
    expect(html).toContain('https://x/signed');
    const incident = renderToStaticMarkup(createElement(IncidentDetails, {
      report: { ...fullReport, kind: 'incident', incident_type: 'damage', told_by: 'Sarah rang', injured_party: null, treatment: null, injury_details: null, damage_details: 'Vase', jobs: null, reporter: null },
    }));
    expect(incident).not.toContain('Who was hurt');
    expect(incident).toContain('Something was damaged or broken');
    expect(incident).toContain('Sarah rang');
    expect(incident).toContain('Vase');
  });

  it('renders the report form for staff and for the office', async () => {
    const { default: IncidentForm } = await import('../app/components/IncidentForm');
    const staff = renderToStaticMarkup(createElement(IncidentForm, { userId: 'u1', initialKind: 'incident', columns: 'id', onSaved() {}, onCancel() {} }));
    expect(staff).toContain('Something went wrong');
    expect(staff).toContain('What kind of incident?');
    expect(staff).not.toContain('Who told you');
    const office = renderToStaticMarkup(createElement(IncidentForm, { userId: 'u1', office: true, columns: 'id', onSaved() {}, onCancel() {} }));
    expect(office).toContain('Who told you about it?');
    expect(office).toContain('Add the report');
  });
});
