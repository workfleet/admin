import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CleanerWeekGrid from '../app/admin/rota/CleanerWeekGrid';
import { buildCleanerRows } from '../lib/rotaGrid';

// A training job is the first job this app has ever had with no property on
// it (0115). Every rota surface reads `job.properties` for the line it puts
// on a block, so the thing most likely to go wrong is not the booking but
// the drawing - and a crash on render is exactly what the build and the
// helper tests both miss. This renders the by-cleaner sheet with a training
// job on it, which is the shape the live rota will hand it.

const monday = new Date('2026-09-14T00:00:00');
const weekDays = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(monday);
  d.setDate(d.getDate() + i);
  return d;
});

const cleaners = [
  { id: 'amira', full_name: 'Amira Shah' },
  { id: 'ben', full_name: 'Ben Okafor' },
];

const on = (id, name) => ({ cleaner_id: id, profiles: { full_name: name } });

const trainingJob = {
  id: 't1',
  kind: 'training',
  scheduled_at: '2026-09-15T09:00:00',
  duration_minutes: 180,
  status: 'scheduled',
  training_title: 'Fire safety refresher',
  training_location: 'Head office',
  training_trainer: 'Dan Powell',
  training_certification_name: 'Fire safety',
  training_certification_expiry: '2029-03-01',
  // The whole point: no property, because 0115 forbids one.
  properties: null,
  property_id: null,
  job_assignments: [on('amira', 'Amira Shah'), on('ben', 'Ben Okafor')],
};

const cleanJob = {
  id: 'j1',
  kind: 'clean',
  scheduled_at: '2026-09-15T07:00:00',
  duration_minutes: 120,
  status: 'scheduled',
  properties: { address: '14 Bridge St', clients: { name: 'Riverside Dental' } },
  job_assignments: [on('amira', 'Amira Shah')],
};

const render = (rowsJobs, dayIndex) => renderToStaticMarkup(createElement(CleanerWeekGrid, {
  rows: buildCleanerRows(rowsJobs, cleaners, weekDays),
  weekDays,
  todayKey: weekDays[1].toDateString(),
  ...(dayIndex === undefined ? {} : { dayIndex }),
  onOpenJob: () => {},
  onNewJob: () => {},
  onDropJob: () => {},
}));

describe('the rota with training on it', () => {
  it('draws a property-less training job without throwing', () => {
    const html = render([cleanJob, trainingJob]);
    expect(html).toContain('Fire safety refresher');
    // It sits on both attendees' rows, like any job with two people on it -
    // twice per chip, because the hover title repeats what the chip says.
    expect(html.match(/rota-chip-client">Fire safety refresher</g)).toHaveLength(2);
    // And it is marked as training rather than passing for a clean.
    expect(html).toContain('is-training');
  });

  it('never borrows a client name or an address it does not have', () => {
    const html = render([trainingJob]);
    expect(html).not.toContain('Unknown client');
    expect(html).not.toContain('undefined');
    // The venue stands in for the address.
    expect(html).toContain('Head office');
  });

  it('says nobody is booked on, rather than that it needs a cleaner', () => {
    const html = render([{ ...trainingJob, job_assignments: [] }]);
    // The chip is what names the gap. The row it lands in is the shared
    // "nothing assigned" row, which still reads "Needs a cleaner" because
    // it holds unassigned cleans too - that row is not training's to rename.
    expect(html).toContain('Nobody booked on');
    expect(html).not.toContain('Needs a cleaner · Drag');
  });

  it('holds up on the single-day view, where the chip opens out', () => {
    const html = render([cleanJob, trainingJob], 1);
    expect(html).toContain('rota-grid is-day');
    expect(html).toContain('Fire safety refresher');
    expect(html).toContain('Head office');
    expect(html).toContain('09:00 – 12:00');
    expect(html).not.toContain('undefined');
  });

  it('still draws a training with nothing but a title on it', () => {
    // Location, trainer and certificate are all optional - a toolbox talk
    // has none of them, and must not render a blank chip.
    const bare = {
      ...trainingJob,
      training_location: null,
      training_trainer: null,
      training_certification_name: null,
      training_certification_expiry: null,
    };
    const html = render([bare]);
    expect(html).toContain('Fire safety refresher');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
  });

  it('leaves an ordinary clean reading exactly as it did', () => {
    const html = render([cleanJob]);
    expect(html).toContain('Riverside Dental');
    expect(html).not.toContain('is-training');
  });
});
