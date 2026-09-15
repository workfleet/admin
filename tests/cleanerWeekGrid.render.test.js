import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CleanerWeekGrid from '../app/admin/rota/CleanerWeekGrid';
import { buildCleanerRows } from '../lib/rotaGrid';

// The build compiles a page without running it, and the unit tests cover
// the helpers. This actually renders the grid once, with the shapes the
// page hands it, so a crash on render is caught here rather than on the
// live rota.

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
const jobs = [
  {
    id: 'j1',
    scheduled_at: '2026-09-15T07:00:00',
    duration_minutes: 120,
    status: 'completed',
    properties: { address: '14 Bridge St', clients: { name: 'Riverside Dental' } },
    job_assignments: [on('amira', 'Amira Shah')],
  },
  {
    id: 'j2',
    scheduled_at: '2026-09-15T09:30:00',
    duration_minutes: 150,
    status: 'in_progress',
    properties: { address: '2 Oak Lane', clients: { name: 'Oak House' } },
    job_assignments: [on('amira', 'Amira Shah'), on('ben', 'Ben Okafor')],
  },
  {
    id: 'j3',
    scheduled_at: '2026-09-16T13:30:00',
    duration_minutes: 120,
    status: 'scheduled',
    properties: { address: '31 Station Rd', clients: null },
    job_assignments: [],
  },
  {
    id: 'j4',
    scheduled_at: '2026-09-19T10:00:00',
    duration_minutes: null,
    status: 'missed',
    properties: null,
    job_assignments: [on('zed', 'Zed Former')],
  },
];

const render = (rowsJobs) => renderToStaticMarkup(createElement(CleanerWeekGrid, {
  rows: buildCleanerRows(rowsJobs, cleaners, weekDays),
  weekDays,
  todayKey: weekDays[1].toDateString(),
  onOpenJob: () => {},
  onNewJob: () => {},
  onDropJob: () => {},
}));

describe('CleanerWeekGrid', () => {
  it('renders a full week without throwing, one row per person plus the unassigned row', () => {
    const html = render(jobs);
    expect(html).toContain('Needs a cleaner');
    expect(html).toContain('Amira Shah');
    expect(html).toContain('Ben Okafor');
    expect(html).toContain('Zed Former');
    expect(html).toContain('no longer on staff');
    // The shared job is on both rows, and the client without a name falls
    // back to the address.
    expect(html.match(/rota-chip-client">Oak House</g)).toHaveLength(2);
    expect(html).toContain('31 Station Rd');
    expect(html).toContain('w/ Ben');
  });

  it('leaves the unassigned row out when nothing needs a cleaner', () => {
    const html = render(jobs.filter((j) => j.id !== 'j3'));
    expect(html).not.toContain('Needs a cleaner');
    expect(html).toContain('Amira Shah');
  });

  it('copes with an empty week', () => {
    const html = render([]);
    expect(html).toContain('0 jobs');
  });
});
