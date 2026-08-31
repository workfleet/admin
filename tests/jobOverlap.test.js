import { describe, it, expect } from 'vitest';
import { groupOverlappingJobs, assignLanes, jobsOverlap, abbreviateName } from '../lib/jobOverlap';

// The rota draws a day on the clock, so two jobs at the same hour would be
// two bars in the same place. Getting this wrong doesn't misprice anything -
// it hides work, which is how six of nine jobs went unreachable.

const at = (time, minutes, id) => ({
  id: id || time,
  scheduled_at: `2026-09-02T${time}:00`,
  duration_minutes: minutes,
});

describe('assignLanes', () => {
  it('puts jobs that genuinely overlap in lanes of their own', () => {
    const { lanes, placed } = assignLanes([
      at('09:00', 60, 'a'),
      at('09:30', 60, 'b'),
      at('09:45', 60, 'c'),
    ]);
    expect(lanes).toBe(3);
    expect(placed.map((p) => p.lane)).toEqual([0, 1, 2]);
  });

  it('reuses a lane once its last job has finished', () => {
    // 9-10 and 10:30-11:30 never share a minute. They land in one group
    // because 9:30-11 bridges them, but they can sit in the same lane -
    // giving all three cards half the column rather than a third of it.
    const { lanes, placed } = assignLanes([
      at('09:00', 60, 'a'),
      at('09:30', 90, 'b'),
      at('10:30', 60, 'c'),
    ]);
    expect(lanes).toBe(2);
    expect(placed.find((p) => p.job.id === 'c').lane).toBe(0);
  });

  it('treats a job with no duration as two hours, like the rest of the rota', () => {
    const { lanes } = assignLanes([
      { id: 'a', scheduled_at: '2026-09-02T09:00:00' },
      at('10:30', 30, 'b'),
    ]);
    expect(lanes).toBe(2);
  });

  it('orders by start time whatever order it is handed', () => {
    const { placed } = assignLanes([at('11:00', 60, 'c'), at('09:00', 60, 'a'), at('10:00', 60, 'b')]);
    expect(placed.map((p) => p.job.id)).toEqual(['a', 'b', 'c']);
  });

  it('reaches a card across lanes that hold nothing overlapping it', () => {
    // Three at 09:00 force three lanes, and the long bridge job a fourth.
    // The 13:00 job reaches across the two lanes that are empty by then,
    // but stops at the bridge's - that one runs until 14:30, so it is still
    // there. Three quarters of the column instead of one, and still nothing
    // drawn on top of anything.
    const { lanes, placed } = assignLanes([
      at('09:00', 60, 'a'), at('09:00', 60, 'b'), at('09:00', 60, 'c'),
      at('09:30', 300, 'bridge'), at('13:00', 60, 'late'),
    ]);
    expect(lanes).toBe(4);
    expect(placed.find((p) => p.job.id === 'late').span).toBe(3);
    expect(placed.find((p) => p.job.id === 'a').span).toBe(1);
  });

  it('never reaches a card into a lane that is occupied at the time', () => {
    // The guarantee the whole layout rests on: no two cards in one place.
    const { lanes, placed } = assignLanes([
      at('09:00', 120, 'a'), at('09:30', 60, 'b'), at('10:30', 60, 'c'),
    ]);
    placed.forEach((p) => {
      placed.forEach((q) => {
        if (p === q) return;
        const columnsClash = p.lane < q.lane + q.span && q.lane < p.lane + p.span;
        if (columnsClash) expect(jobsOverlap(p.job, q.job)).toBe(false);
      });
    });
    expect(lanes).toBeGreaterThan(0);
  });

  it('gives a lone job the whole width', () => {
    const { lanes, placed } = assignLanes([at('09:00', 60, 'a')]);
    expect(lanes).toBe(1);
    expect(placed[0].lane).toBe(0);
    expect(placed[0].span).toBe(1);
  });

  it('survives an empty day', () => {
    expect(assignLanes([]).lanes).toBe(1);
    expect(assignLanes(undefined).placed).toEqual([]);
  });

  it('lays out every job in a group it is given, however many', () => {
    // The nine-job run that started this: every job must come back out,
    // because the lane layout is now the only way to reach them.
    const jobs = Array.from({ length: 9 }, (_, i) => at(`0${8 + Math.floor(i / 3)}:${(i % 3) * 20}`.replace(':0', ':00').slice(0, 5), 45, `j${i}`));
    const { placed } = assignLanes(jobs);
    expect(placed).toHaveLength(9);
    expect(new Set(placed.map((p) => p.job.id)).size).toBe(9);
  });
});

describe('groupOverlappingJobs feeds the lanes', () => {
  it('keeps a transitive run together so the lanes see all of it', () => {
    const groups = groupOverlappingJobs([
      at('09:00', 60, 'a'),
      at('09:30', 90, 'b'),
      at('10:30', 60, 'c'),
    ]);
    expect(groups).toHaveLength(1);
    expect(assignLanes(groups[0].jobs).placed).toHaveLength(3);
  });

  it('leaves jobs that never touch in separate groups', () => {
    const groups = groupOverlappingJobs([at('09:00', 60, 'a'), at('14:00', 60, 'b')]);
    expect(groups).toHaveLength(2);
    expect(jobsOverlap(at('09:00', 60), at('14:00', 60))).toBe(false);
  });
});

describe('abbreviateName', () => {
  it('shortens a full name to fit one line of a card', () => {
    expect(abbreviateName('Jane Kaminski')).toBe('J. Kaminski');
    expect(abbreviateName('Nadia')).toBe('Nadia');
    expect(abbreviateName('')).toBe('');
  });
});
