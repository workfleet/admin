import { describe, it, expect } from 'vitest';
import { projectPricePeriods, pricePeriodSuffix } from '../lib/quoteCalculator';
import { quoteSections } from '../lib/quoteTemplate';

// A price typed per week has to come out as the same annual figure as the
// equivalent price typed per month or per year - otherwise the office is
// shown a different contract value depending on which box they filled in.

describe('projectPricePeriods', () => {
  it('projects a weekly price into month and year', () => {
    const p = projectPricePeriods(100, 'week');
    expect(p).toEqual({ weekly: 100, monthly: 433.33, annual: 5200 });
  });

  it('agrees whichever period the price was typed in', () => {
    const fromYear = projectPricePeriods(5200, 'year');
    const fromMonth = projectPricePeriods(5200 / 12, 'month');
    expect(fromYear).toEqual({ weekly: 100, monthly: 433.33, annual: 5200 });
    expect(fromMonth).toEqual({ weekly: 100, monthly: 433.33, annual: 5200 });
  });

  it('has nothing to project for a one-off or per-visit price', () => {
    expect(projectPricePeriods(120, 'one_off')).toBeNull();
    expect(projectPricePeriods(120, 'visit')).toBeNull();
    expect(projectPricePeriods(120, undefined)).toBeNull();
  });

  it('refuses a price that is not a number', () => {
    expect(projectPricePeriods('', 'week')).toBeNull();
    expect(projectPricePeriods(null, 'week')).toBeNull();
  });
});

describe('pricePeriodSuffix', () => {
  it('reads as a unit on the price, and is silent for a one-off', () => {
    expect(pricePeriodSuffix('week')).toBe(' per week');
    expect(pricePeriodSuffix('one_off')).toBe('');
    // Quotes saved before the column existed.
    expect(pricePeriodSuffix(undefined)).toBe('');
  });
});

describe('quote document with a per-period price', () => {
  const quote = {
    id: '1', prospect_name: 'Acme Ltd', description: 'Weekly office clean',
    price: 180, price_period: 'week', created_at: '2026-09-21T09:00:00Z',
    calculator_input: null, calculator_breakdown: null, shift_schedule: null,
  };

  it('prints the price with its period and projects the contract value', () => {
    const sections = quoteSections(quote);
    const pricing = sections.find((s) => s.title === 'Pricing');
    expect(pricing.blocks[0]).toMatchObject({ type: 'price', value: '£180.00 per week' });

    const value = sections.find((s) => s.title === 'Contract Value');
    const rows = value.blocks.find((b) => b.type === 'table').rows;
    expect(rows).toEqual([
      ['Per week', '£180.00'],
      ['Per month', '£780.00'],
      ['Per year', '£9,360.00'],
    ]);
  });

  it('leaves a one-off quote exactly as it was', () => {
    const sections = quoteSections({ ...quote, price_period: 'one_off' });
    expect(sections.find((s) => s.title === 'Pricing').blocks[0].value).toBe('£180.00');
    expect(sections.find((s) => s.title === 'Contract Value')).toBeUndefined();
  });
});
