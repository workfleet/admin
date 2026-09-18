import { describe, it, expect } from 'vitest';
import {
  greetingFor,
  firstNameOf,
  splitJobsForHome,
  startOfWeek,
  hoursThisWeek,
  hoursLeftThisWeek,
  jobsCompletedThisMonth,
  daySummary,
  unreadMessageCount,
  unreadSince,
  ratingSummary,
} from '../lib/homeSummary';

// Wednesday 17 September 2026, 10:30 local.
const NOW = new Date(2026, 8, 17, 10, 30);
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();
const job = (id, scheduledAt, status = 'scheduled', minutes = 120, address = `${id} Street`) => ({
  id, scheduled_at: scheduledAt, status, duration_minutes: minutes, properties: { address },
});

describe('greetingFor', () => {
  it('follows the clock', () => {
    expect(greetingFor(new Date(2026, 8, 17, 7))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 8, 17, 11, 59))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 8, 17, 12))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 8, 17, 18))).toBe('Good evening');
  });
});

describe('firstNameOf', () => {
  it('uses the first word of the full name', () => {
    expect(firstNameOf('Sarah Jane Smith')).toBe('Sarah');
    expect(firstNameOf('  Tom ')).toBe('Tom');
  });

  it('falls back when there is no name yet', () => {
    expect(firstNameOf(null)).toBe('there');
    expect(firstNameOf('')).toBe('there');
  });
});

describe('splitJobsForHome', () => {
  it('finds the current job, the next one, and everything today', () => {
    const jobs = [
      job('a', at(17, 8), 'completed'),
      job('b', at(17, 11)),
      job('c', at(17, 14)),
      job('d', at(18, 9)),
    ];
    const split = splitJobsForHome(jobs, NOW);
    expect(split.current).toBeNull();
    expect(split.upNext.id).toBe('b');
    expect(split.today.map((j) => j.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a job they are late for as up next', () => {
    // 9am job, it is 10:30, nobody has clocked in - that is still the job
    // they should be looking at, not one to skip past.
    const jobs = [job('late', at(17, 9)), job('later', at(17, 14))];
    expect(splitJobsForHome(jobs, NOW).upNext.id).toBe('late');
  });

  it('does not treat yesterday\'s unstarted job as up next', () => {
    const jobs = [job('old', at(16, 9)), job('tomorrow', at(18, 9))];
    expect(splitJobsForHome(jobs, NOW).upNext.id).toBe('tomorrow');
  });

  it('surfaces the job they are clocked in to', () => {
    const jobs = [job('on', at(17, 9), 'in_progress'), job('next', at(17, 14))];
    const split = splitJobsForHome(jobs, NOW);
    expect(split.current.id).toBe('on');
    expect(split.upNext.id).toBe('next');
  });

  it('copes with an empty rota', () => {
    expect(splitJobsForHome([], NOW)).toEqual({ current: null, upNext: null, today: [] });
  });
});

describe('startOfWeek', () => {
  it('goes back to the Monday', () => {
    expect(startOfWeek(NOW)).toEqual(new Date(2026, 8, 14));
  });

  it('treats Sunday as the end of the week, not the start', () => {
    expect(startOfWeek(new Date(2026, 8, 20, 15))).toEqual(new Date(2026, 8, 14));
  });

  it('leaves a Monday where it is', () => {
    expect(startOfWeek(new Date(2026, 8, 14, 23))).toEqual(new Date(2026, 8, 14));
  });
});

describe('hoursThisWeek / hoursLeftThisWeek', () => {
  const jobs = [
    job('lastweek', at(13, 9), 'completed', 120),     // Sunday before - out
    job('mon', at(14, 9), 'completed', 120),          // 2h
    job('tue', at(15, 9), 'completed', 120),          // shared by 2 - 1h
    job('wed', at(17, 14), 'scheduled', 90),          // still to come
    job('sun', at(20, 9), 'scheduled', 60),           // still to come
    job('nextmon', at(21, 9), 'scheduled', 240),      // next week - out
  ];
  const counts = { tue: 2 };

  it('counts only completed jobs dated Monday to Sunday of this week', () => {
    expect(hoursThisWeek(jobs, counts, NOW)).toBe(3);
  });

  it('adds up what is still booked this week', () => {
    expect(hoursLeftThisWeek(jobs, counts, NOW)).toBe(2.5);
  });
});

describe('jobsCompletedThisMonth', () => {
  it('counts completed jobs in the calendar month only', () => {
    const jobs = [
      job('a', at(1, 9), 'completed'),
      job('b', at(16, 9), 'completed'),
      job('c', at(17, 14), 'scheduled'),
      { ...job('d', new Date(2026, 7, 31, 9).toISOString(), 'completed') },
      job('e', at(17, 9), 'missed'),
    ];
    expect(jobsCompletedThisMonth(jobs, NOW)).toBe(2);
  });
});

describe('daySummary', () => {
  it('names the next job time when there is more to do', () => {
    const split = splitJobsForHome([job('a', at(17, 8), 'completed'), job('b', at(17, 11))], NOW);
    expect(daySummary(split, NOW)).toMatch(/^2 jobs today, next at 11:00/);
  });

  it('says so when the day is done', () => {
    const split = splitJobsForHome([job('a', at(17, 8), 'completed')], NOW);
    expect(daySummary(split, NOW)).toBe('1 job today, all done');
  });

  it('points at tomorrow when today is empty', () => {
    const split = splitJobsForHome([job('a', at(18, 9))], NOW);
    expect(daySummary(split, NOW)).toMatch(/^Nothing today - next job tomorrow at 9:00/);
  });

  it('names the weekday when the next job is further off', () => {
    const split = splitJobsForHome([job('a', at(21, 9))], NOW);
    expect(daySummary(split, NOW)).toMatch(/^Nothing today - next job Monday at 9:00/);
  });

  it('is honest about an empty rota', () => {
    expect(daySummary(splitJobsForHome([], NOW), NOW)).toBe('Nothing on the rota yet');
  });

  it('leads with the job they are on', () => {
    const split = splitJobsForHome([job('on', at(17, 9), 'in_progress', 120, '12 High St')], NOW);
    expect(daySummary(split, NOW)).toBe("You're clocked in at 12 High St");
  });
});

describe('unreadMessageCount', () => {
  const me = 'me';
  const participants = [
    { conversation_id: 'office', last_read_at: at(17, 9) },
    { conversation_id: 'team', last_read_at: at(16, 18) },
  ];
  const msg = (conv, sender, when) => ({ conversation_id: conv, sender_id: sender, created_at: when });

  it('counts messages from others after each conversation\'s own read mark', () => {
    const messages = [
      msg('office', 'boss', at(17, 8)),   // read
      msg('office', 'boss', at(17, 10)),  // unread
      msg('team', 'sam', at(17, 7)),      // unread - team was read yesterday evening
      msg('team', 'sam', at(16, 12)),     // read
    ];
    expect(unreadMessageCount(participants, messages, me)).toBe(2);
  });

  it('never counts my own messages', () => {
    const messages = [msg('office', me, at(17, 10)), msg('office', me, at(17, 11))];
    expect(unreadMessageCount(participants, messages, me)).toBe(0);
  });

  it('counts a message whose sender account has since been deleted', () => {
    // sender_id goes null when a profile is removed; the messages page
    // still shows and counts it, so this must too.
    const messages = [msg('office', null, at(17, 10))];
    expect(unreadMessageCount(participants, messages, me)).toBe(1);
  });

  it('does not count a message stamped exactly at the read mark', () => {
    const messages = [msg('office', 'boss', at(17, 9))];
    expect(unreadMessageCount(participants, messages, me)).toBe(0);
  });

  it('handles the microsecond timestamps Postgres actually sends', () => {
    // JS keeps milliseconds and drops the rest, so a message a few
    // microseconds before the read mark lands on the same millisecond
    // and reads as not-after - matching the messages page's comparison.
    const rows = [{ conversation_id: 'office', last_read_at: '2026-09-17T09:00:00.123456+00:00' }];
    const messages = [
      msg('office', 'boss', '2026-09-17T09:00:00.123400+00:00'),
      msg('office', 'boss', '2026-09-17T09:00:00.124001+00:00'),
    ];
    expect(unreadMessageCount(rows, messages, me)).toBe(1);
  });

  it('ignores conversations I am not in', () => {
    expect(unreadMessageCount(participants, [msg('other', 'x', at(17, 10))], me)).toBe(0);
  });

  it('treats a missing read mark as never read, like the messages page', () => {
    const withNull = [...participants, { conversation_id: 'nomark', last_read_at: null }];
    expect(unreadMessageCount(withNull, [msg('nomark', 'x', at(1, 10))], me)).toBe(1);
  });

  it('copes with nothing loaded', () => {
    expect(unreadMessageCount(null, null, me)).toBe(0);
    expect(unreadMessageCount([], [], me)).toBe(0);
  });
});

describe('unreadSince', () => {
  it('returns the earliest read mark as an ISO string', () => {
    const rows = [
      { conversation_id: 'a', last_read_at: at(17, 9) },
      { conversation_id: 'b', last_read_at: at(16, 18) },
      { conversation_id: 'c', last_read_at: null },
    ];
    expect(unreadSince(rows)).toBe(new Date(at(16, 18)).toISOString());
  });

  it('never lands after the true earliest mark when microseconds are dropped', () => {
    const rows = [{ conversation_id: 'a', last_read_at: '2026-09-16T18:00:00.123456+00:00' }];
    expect(unreadSince(rows)).toBe('2026-09-16T18:00:00.123Z');
  });

  it('is null when there is nothing to bound by', () => {
    expect(unreadSince([])).toBeNull();
    expect(unreadSince([{ conversation_id: 'a', last_read_at: null }])).toBeNull();
    expect(unreadSince(null)).toBeNull();
  });
});

describe('ratingSummary', () => {
  it('leads with the newest rating and averages the rest', () => {
    const rows = [
      { rating: 5, comment: 'Spotless', created_at: at(16, 12) },
      { rating: 4, comment: null, created_at: at(10, 12) },
      { rating: 3, comment: 'Fine', created_at: at(3, 12) },
    ];
    const summary = ratingSummary(rows);
    expect(summary.latest.comment).toBe('Spotless');
    expect(summary.average).toBe(4);
    expect(summary.count).toBe(3);
  });

  it('skips rows without a usable rating', () => {
    expect(ratingSummary([{ rating: null }, { rating: 5 }]).count).toBe(1);
  });

  it('is null with no ratings', () => {
    expect(ratingSummary([])).toBeNull();
    expect(ratingSummary(null)).toBeNull();
  });
});
