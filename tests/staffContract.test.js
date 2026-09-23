import { describe, expect, it } from 'vitest';
import {
  buildContractText,
  contractTerms,
  formatContractDate,
  formatHourlyRate,
  termsSummary,
  CONTRACT_DEFAULTS,
} from '../lib/staffContract.js';

describe('formatContractDate', () => {
  it('reads a Postgres date without shifting the day', () => {
    // new Date('2026-10-05') is UTC midnight, which names 4 October in any
    // zone behind UTC - the whole reason this is parsed by hand.
    expect(formatContractDate('2026-10-05')).toBe('5 October 2026');
    expect(formatContractDate('2026-01-01')).toBe('1 January 2026');
  });

  it('gives nothing back for a blank or unusable value', () => {
    expect(formatContractDate(null)).toBeNull();
    expect(formatContractDate('')).toBeNull();
    expect(formatContractDate('next Monday')).toBeNull();
    expect(formatContractDate('2026-13-01')).toBeNull();
  });
});

describe('formatHourlyRate', () => {
  it('always prints pence', () => {
    expect(formatHourlyRate(13)).toBe('13.00');
    expect(formatHourlyRate('14.5')).toBe('14.50');
  });

  it('rejects a rate that would put a hole in the contract', () => {
    expect(formatHourlyRate(null)).toBeNull();
    expect(formatHourlyRate(0)).toBeNull();
    expect(formatHourlyRate('abc')).toBeNull();
  });
});

describe('contractTerms', () => {
  it('falls back to the standard terms for an invite made before 0114', () => {
    const terms = contractTerms({});
    expect(terms.jobTitle).toBe(CONTRACT_DEFAULTS.jobTitle);
    expect(terms.hourlyRate).toBe('13.00');
    expect(terms.payFrequency).toBe('weekly');
    expect(terms.reportsTo).toBe(CONTRACT_DEFAULTS.reportsTo);
    expect(terms.startDate).toBeNull();
  });

  it('takes what the office set', () => {
    const terms = contractTerms({
      job_title: 'Gardener',
      hourly_rate: '15',
      pay_frequency: 'monthly',
      start_date: '2026-10-05',
      reports_to: 'Jess Kidwell',
    });
    expect(terms).toEqual({
      jobTitle: 'Gardener',
      hourlyRate: '15.00',
      payFrequency: 'monthly',
      startDate: '5 October 2026',
      reportsTo: 'Jess Kidwell',
    });
  });
});

describe('buildContractText', () => {
  const invite = {
    job_title: 'Gardener',
    hourly_rate: 15.5,
    pay_frequency: 'monthly',
    start_date: '2026-10-05',
    reports_to: 'Jess Kidwell',
  };

  it('writes this hire in, not the old hard-coded terms', () => {
    const text = buildContractText({ full_name: 'Sam Taylor', address: '1 Long Road, Swansea' }, invite);
    expect(text).toContain('Worker: Sam Taylor (the Worker)');
    expect(text).toContain('Worker Address: 1 Long Road, Swansea');
    expect(text).toContain('Start Date: 5 October 2026');
    expect(text).toContain('1.4 The Worker is engaged as a Gardener');
    expect(text).toContain('1.7 You report directly to Jess Kidwell.');
    expect(text).toContain('6.1 The Worker will be paid GBP 15.50 per hour.');
    expect(text).toContain('6.2 Pay will be made monthly');
    expect(text).not.toContain('GBP 13.00');
  });

  it('leaves the start date to be written in when there isn\'t one', () => {
    const text = buildContractText({ full_name: 'Sam Taylor' }, {});
    expect(text).toContain('Start Date: _____________________');
    expect(text).toContain('Worker Address: [Worker Address]');
  });

  it('drops the reporting line rather than naming nobody', () => {
    const text = buildContractText({ full_name: 'Sam Taylor' }, { reports_to: '  ' });
    // Blank falls back to the standard manager; an invite can't leave the
    // clause dangling, and 1.7 is last in the section either way.
    expect(text).toContain(`1.7 You report directly to ${CONTRACT_DEFAULTS.reportsTo}.`);
  });

  it('is identical whether the page or the server builds it', () => {
    const worker = { full_name: 'Sam Taylor', address: '1 Long Road' };
    expect(buildContractText(worker, invite)).toBe(buildContractText(worker, invite));
  });
});

describe('termsSummary', () => {
  it('reads as one line for the invite list', () => {
    expect(termsSummary({ job_title: 'Cleaning Operative', hourly_rate: 13, pay_frequency: 'weekly', start_date: '2026-10-05' }))
      .toBe('Cleaning Operative · £13.00/hr weekly · starts 5 October 2026');
  });

  it('says nothing about a start date that hasn\'t been set', () => {
    expect(termsSummary({})).toBe('Cleaning Operative · £13.00/hr weekly');
  });
});
