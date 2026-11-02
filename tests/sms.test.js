import { describe, it, expect } from 'vitest';
import { normaliseUkMobile, composeShiftText } from '../lib/sms';

describe('normaliseUkMobile', () => {
  it('accepts the ways a UK mobile gets typed', () => {
    for (const raw of ['07700 900123', '07700900123', '+44 7700 900123', '+44 (0)7700 900123', '447700900123', '0044 7700-900-123', '7700900123']) {
      expect(normaliseUkMobile(raw)).toBe('+447700900123');
    }
  });

  it('refuses landlines, short numbers and blanks', () => {
    expect(normaliseUkMobile('01234 567890')).toBeNull();
    expect(normaliseUkMobile('0770090012')).toBeNull();
    expect(normaliseUkMobile('')).toBeNull();
    expect(normaliseUkMobile(null)).toBeNull();
  });
});

describe('composeShiftText', () => {
  it('sends a single change as one sentence', () => {
    expect(composeShiftText(['New shift: Axis Court, Mon 3 Nov, 09:00'], 'Sarah'))
      .toBe('CrewConnect: Hi Sarah, new shift: Axis Court, Mon 3 Nov, 09:00\nSee the app for details.');
  });

  it('lists several changes and counts the rest', () => {
    const lines = ['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `New shift: ${x}`);
    const text = composeShiftText(lines, 'Ben');
    expect(text).toContain('Hi Ben, 6 changes to your rota:');
    expect(text).toContain('- New shift: d');
    expect(text).not.toContain('- New shift: e');
    expect(text).toContain('- and 2 more');
  });

  it('keeps to plain characters so a text is not charged as Unicode', () => {
    const text = composeShiftText(['New shift: St Mary’s – Hall'], null);
    expect(text).toBe("CrewConnect: New shift: St Mary's - Hall\nSee the app for details.");
  });
});
