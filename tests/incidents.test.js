import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildIncidentRow, riddorPrompts, needsRiddorDecision, incidentSummary, csvRow, CSV_COLUMNS,
} from '../lib/incidents';
import { toCSV } from '../lib/csv';
import IncidentDetails from '../app/components/IncidentDetails';

// The form's rules must match 0117's check constraint, or a report someone
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
  days_off_work: null, riddor_reportable: null, ...over,
});

describe('riddorPrompts', () => {
  it('says nothing for a near miss or a first-aid bump', () => {
    expect(riddorPrompts({ kind: 'near_miss' })).toEqual([]);
    expect(riddorPrompts(accident())).toEqual([]);
  });

  it('gives the 15-day deadline once a worker is off more than 7 days', () => {
    const [p] = riddorPrompts(accident({ days_off_work: 8 }));
    expect(p.key).toBe('over7');
    expect(p.due.toISOString().slice(0, 10)).toBe('2026-09-16');
  });

  it('notes over-3 days without calling it reportable', () => {
    expect(riddorPrompts(accident({ days_off_work: 4 })).map((p) => p.key)).toEqual(['over3']);
  });

  it('treats hospital differently for a worker and for the public', () => {
    expect(riddorPrompts(accident({ treatment: 'hospital' })).map((p) => p.key)).toEqual(['specified']);
    expect(riddorPrompts(accident({ injured_party: 'public', injured_name: 'X', treatment: 'hospital' })).map((p) => p.key)).toEqual(['public_hospital']);
  });

  it('stops flagging once the office has decided', () => {
    expect(needsRiddorDecision(accident({ treatment: 'hospital' }))).toBe(true);
    expect(needsRiddorDecision(accident({ treatment: 'hospital', riddor_reportable: false }))).toBe(false);
  });
});

const fullReport = {
  id: 'r1', kind: 'accident', occurred_at: '2026-09-26T09:30:00Z', created_at: '2026-09-26T10:00:00Z',
  location: '12 High Street', description: 'Cut hand on broken glass, "deep"', injured_party: 'client',
  injured_name: 'Mrs Patel', injury_details: 'Cut palm', treatment: 'gp', damage_details: null,
  immediate_action: 'Cleaned and covered', witnesses: null, photo_paths: ['u1/a.jpg'], status: 'open',
  riddor_reportable: null, reporter: { full_name: 'Sam Jones' }, jobs: { properties: { address: '12 High Street' } },
};

describe('display and export', () => {
  it('summarises who was hurt', () => {
    expect(incidentSummary(fullReport)).toBe('Mrs Patel hurt - gp, walk-in or minor injuries');
    expect(incidentSummary({ kind: 'near_miss' })).toBe('Near miss - nobody hurt');
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
    const html = renderToStaticMarkup(createElement(IncidentDetails, { report: fullReport, photoUrls: ['https://x/signed'] }));
    expect(html).toContain('Mrs Patel');
    expect(html).toContain('Sam Jones');
    expect(html).toContain('https://x/signed');
    const nearMiss = renderToStaticMarkup(createElement(IncidentDetails, {
      report: { ...fullReport, kind: 'near_miss', injured_party: null, treatment: null, injury_details: null, jobs: null, reporter: null },
    }));
    expect(nearMiss).not.toContain('Who was hurt');
  });
});
