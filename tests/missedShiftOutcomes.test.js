import { describe, expect, it } from 'vitest';
import {
  MISSED_SHIFT_OUTCOMES,
  countsAgainstCleaner,
  isJobWideOutcome,
  outcomeLabel,
} from '../lib/missedShiftOutcomes.js';

describe('missed shift outcomes', () => {
  it('matches the check constraint in migration 0093', () => {
    expect(MISSED_SHIFT_OUTCOMES.map((o) => o.key).sort()).toEqual(
      ['authorised_absence', 'client_cancelled', 'no_show', 'sick', 'turned_away']
    );
  });

  it('only a no-show counts against the person', () => {
    expect(countsAgainstCleaner('no_show')).toBe(true);
    expect(countsAgainstCleaner('client_cancelled')).toBe(false);
    expect(countsAgainstCleaner('sick')).toBe(false);
    expect(countsAgainstCleaner('authorised_absence')).toBe(false);
    expect(countsAgainstCleaner('turned_away')).toBe(false);
  });

  it('treats nothing recorded, or something unknown, as it always did', () => {
    expect(countsAgainstCleaner(null)).toBe(true);
    expect(countsAgainstCleaner(undefined)).toBe(true);
    expect(countsAgainstCleaner('abducted')).toBe(true);
  });

  it('a cancellation is about the job, the rest about the person', () => {
    expect(isJobWideOutcome('client_cancelled')).toBe(true);
    expect(MISSED_SHIFT_OUTCOMES.filter((o) => o.key !== 'client_cancelled').every((o) => !isJobWideOutcome(o.key))).toBe(true);
  });

  it('has a label for everything and a fallback for anything else', () => {
    for (const o of MISSED_SHIFT_OUTCOMES) expect(outcomeLabel(o.key)).toBe(o.label);
    expect(outcomeLabel('abducted')).toBe('Recorded');
  });
});
