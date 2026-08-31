import { describe, it, expect } from 'vitest';
import {
  calculateQuote,
  rebaseBreakdownToPrice,
  PRICING_DEFAULTS,
} from '../lib/quoteCalculator';

// What this file is guarding
// --------------------------
// calculateQuote decides what a client is charged. Until now the only thing
// checking it was somebody reading it - which is how the last round of
// pricing faults was found, after the quotes had already gone out.
//
// The tests below deliberately assert the *reasoning* rather than a column of
// magic numbers: that the margin comes out at target, that the floors apply to
// one-off work and not to contract visits, and that a setting which cannot be
// read falls back loudly instead of pricing labour at zero. A test that only
// pins today's output tells you a number moved, not whether it should have.

const settings = { ...PRICING_DEFAULTS };

// A house big enough that cost-plus pricing clears the £120 minimum, so the
// floors are out of the way and the margin arithmetic is what's on trial.
const threeBedHouse = {
  serviceType: 'cleaning',
  propertyType: '3 Bed House',
  condition: 'Standard',
  cleanType: 'Pre-Let Clean',
  furnished: 'No',
  rooms: { bedroom: 3, bathroom: 1, kitchen: 1, living: 1, hallway: 1, staircase: 1 },
  oven: 'none',
  addons: {},
  travelMiles: 0,
};

describe('calculateQuote - margin', () => {
  it('prices at the target margin once the minimum job price is cleared', () => {
    const b = calculateQuote(threeBedHouse, settings);

    expect(b.finalPrice).toBeGreaterThan(settings.minimum_job_price);
    // The whole point of cost-plus: price = cost / (1 - margin), so the
    // margin on the resulting price is the target, exactly.
    expect(b.marginPct).toBeCloseTo(settings.target_margin_pct, 4);
    expect(b.profit).toBeCloseTo(b.finalPrice - b.totalTrueCostInclOven, 2);
  });

  it('bills the oven as a flat charge on top, not through the hourly stack', () => {
    const withoutOven = calculateQuote(threeBedHouse, settings);
    const withOven = calculateQuote({ ...threeBedHouse, oven: 'double' }, settings);

    expect(withOven.finalPrice).toBeCloseTo(withoutOven.finalPrice + 80, 2);
    expect(withOven.chargeableHours).toBe(withoutOven.chargeableHours);
    // £80 charged against £45 paid out - the margin on the job as a whole
    // moves, so it must not still report the headline target.
    expect(withOven.totalTrueCostInclOven).toBeCloseTo(withoutOven.totalTrueCostInclOven + 45, 2);
  });

  it('counts travel into the cost stack rather than adding it to the price', () => {
    const near = calculateQuote(threeBedHouse, settings);
    const far = calculateQuote({ ...threeBedHouse, travelMiles: 20 }, settings);

    expect(far.travelCost).toBeCloseTo(20 * settings.travel_cost_per_mile, 2);
    // Marked up like any other cost, so the margin survives the mileage.
    expect(far.marginPct).toBeCloseTo(settings.target_margin_pct, 4);
    expect(far.finalPrice).toBeGreaterThan(near.finalPrice);
  });
});

describe('calculateQuote - hours', () => {
  it('rounds up to the next half hour', () => {
    // One bedroom (35m) + one hallway (20m) = 55 minutes, which nobody
    // schedules as 0.92 of an hour.
    const b = calculateQuote(
      { ...threeBedHouse, rooms: { bedroom: 1, hallway: 1 } },
      settings
    );
    expect(b.totalAdjustedMinutes).toBe(55);
    expect(b.totalHours).toBe(1);
  });

  it('applies condition, clean type and furnishing multiplicatively', () => {
    const b = calculateQuote(
      {
        ...threeBedHouse,
        rooms: { kitchen: 1 }, // 90 minutes flat
        condition: 'Heavy', // 1.3
        cleanType: 'Deep Clean', // 1.2
        furnished: 'Yes', // 1.2
      },
      settings
    );
    expect(b.totalAdjustedMinutes).toBeCloseTo(90 * 1.3 * 1.2 * 1.2, 2);
  });

  it('keeps a deliberately entered add-on quantity of zero at zero', () => {
    // The guard here is that only a genuinely missing quantity defaults to 1.
    // Number('') is 0 and `|| 1` turns a real 0 into 1, either of which
    // silently bills for work nobody agreed to.
    const zero = calculateQuote(
      { ...threeBedHouse, addons: { petHair: true, petHairQty: 0 } },
      settings
    );
    const absent = calculateQuote(
      { ...threeBedHouse, addons: { petHair: true } },
      settings
    );

    expect(zero.addonMinutes).toBe(0);
    expect(absent.addonMinutes).toBe(30);
  });
});

describe('calculateQuote - floors on one-off work', () => {
  it('charges the minimum callout and minimum job price for an empty form', () => {
    const b = calculateQuote({ serviceType: 'cleaning', rooms: {}, addons: {} }, settings);

    expect(b.totalHours).toBe(0);
    expect(b.chargeableHours).toBe(settings.minimum_callout_hours);
    expect(b.finalPrice).toBe(settings.minimum_job_price);
    // Divided by the hours actually charged for. £120 across the 3-hour
    // minimum is £40/hr - not the £0/hr that once read as "Very Competitive".
    expect(b.hourlyEquivalent).toBe(40);
    expect(b.pricePosition).toBe('Premium');
  });
});

describe('calculateQuote - commercial contracts', () => {
  const commercial = {
    serviceType: 'commercial',
    condition: 'Standard',
    estimatedHours: 1,
    addons: {},
    travelMiles: 0,
  };

  it('floors a one-off commercial visit like any other one-off job', () => {
    const b = calculateQuote({ ...commercial, commercialFrequency: 'One-off' }, settings);

    expect(b.chargeableHours).toBe(settings.minimum_callout_hours);
    expect(b.finalPrice).toBe(settings.minimum_job_price);
    expect(b.visitsPerWeek).toBe(0);
  });

  it('floors a recurring visit on hours only, never on the minimum job price', () => {
    // A contract visit is not a job worth mobilising for on its own, so the
    // one-off minimums must not compound across every visit in the week.
    const b = calculateQuote({ ...commercial, commercialFrequency: 'Daily (5x/week)' }, settings);

    expect(b.chargeableHours).toBe(settings.commercial_recurring_min_hours);
    expect(b.finalPrice).toBeLessThan(settings.minimum_job_price);
    expect(b.marginPct).toBeCloseTo(settings.target_margin_pct, 4);
  });

  it('projects the per-visit price into weekly and monthly contract value', () => {
    const b = calculateQuote({ ...commercial, estimatedHours: 2, commercialFrequency: 'Daily (5x/week)' }, settings);

    expect(b.visitsPerWeek).toBe(5);

    // Within a penny, not to the penny, and that is a real quirk rather than
    // a loose test: contract value is projected from the *unrounded* price and
    // rounded once at the end, so a quote can read "£48.55 per visit,
    // £242.74/week" when 48.55 x 5 is £242.75. Harmless arithmetically, but a
    // client who checks the multiplication finds a penny missing. Deriving it
    // from the rounded per-visit figure instead would make the document
    // self-consistent - left alone here because that changes what clients are
    // quoted, which is a decision rather than a fix.
    expect(b.weeklyContractValue).toBeCloseTo(b.finalPrice * 5, 1);
    expect(b.monthlyContractValue).toBeCloseTo(b.weeklyContractValue * (52 / 12), 2);
  });

  it('leaves contract value null for non-recurring work', () => {
    const b = calculateQuote(threeBedHouse, settings);
    expect(b.visitsPerWeek).toBeNull();
    expect(b.weeklyContractValue).toBeNull();
    expect(b.monthlyContractValue).toBeNull();
  });
});

describe('calculateQuote - gardening', () => {
  it('prices off garden size at the gardener rate, not the cleaner rate', () => {
    const b = calculateQuote(
      { serviceType: 'gardening', gardenSize: 'Medium (100-200m²)', condition: 'Standard', addons: {} },
      settings
    );

    expect(b.totalHours).toBe(4);
    expect(b.cleanerWageCost).toBeCloseTo(4 * settings.gardener_hourly_pay, 2);
  });

  it('ignores clean type and furnishing, which mean nothing for a garden', () => {
    const plain = calculateQuote(
      { serviceType: 'gardening', gardenSize: 'Small (up to 100m²)', condition: 'Standard', addons: {} },
      settings
    );
    const noisy = calculateQuote(
      {
        serviceType: 'gardening',
        gardenSize: 'Small (up to 100m²)',
        condition: 'Standard',
        cleanType: 'Post-Build Clean',
        furnished: 'Yes',
        addons: {},
      },
      settings
    );
    expect(noisy.totalAdjustedMinutes).toBe(plain.totalAdjustedMinutes);
  });
});

describe('calculateQuote - unreadable settings', () => {
  // This is not hypothetical. The live database is missing migration 0071,
  // so `commercial_recurring_min_hours` genuinely does not exist on the row
  // the app reads - every quote priced today is exercising this path.
  it('falls back to the built-in default when a column is missing', () => {
    const { commercial_recurring_min_hours: _missing, ...withoutColumn } = settings;

    const b = calculateQuote(
      { serviceType: 'commercial', estimatedHours: 1, condition: 'Standard', commercialFrequency: 'Weekly', addons: {} },
      withoutColumn
    );

    expect(b.chargeableHours).toBe(PRICING_DEFAULTS.commercial_recurring_min_hours);
    expect(b.settingsFallbacks).toContain('commercial_recurring_min_hours');
  });

  it('treats null and empty string as absent rather than as zero', () => {
    // Number(null) and Number('') are both 0. Priced bare, that pays the
    // cleaner nothing and quietly underprices the entire quote.
    const b = calculateQuote(threeBedHouse, {
      ...settings,
      cleaner_hourly_pay: '',
      target_margin_pct: null,
    });

    expect(b.settingsFallbacks).toContain('cleaner_hourly_pay');
    expect(b.settingsFallbacks).toContain('target_margin_pct');
    expect(b.cleanerWageCost).toBeCloseTo(b.chargeableHours * PRICING_DEFAULTS.cleaner_hourly_pay, 2);
    expect(b.marginPct).toBeCloseTo(PRICING_DEFAULTS.target_margin_pct, 4);
  });

  it('reports nothing when every setting reads cleanly', () => {
    expect(calculateQuote(threeBedHouse, settings).settingsFallbacks).toEqual([]);
  });

  it('accepts numeric strings, which is how Postgres numerics arrive', () => {
    const b = calculateQuote(threeBedHouse, { ...settings, cleaner_hourly_pay: '16.50' });

    expect(b.settingsFallbacks).not.toContain('cleaner_hourly_pay');
    expect(b.cleanerWageCost).toBeCloseTo(b.chargeableHours * 16.5, 2);
  });
});

describe('rebaseBreakdownToPrice', () => {
  it('recomputes margin against a hand-edited price and remembers the original', () => {
    const original = calculateQuote(threeBedHouse, settings);
    const discounted = rebaseBreakdownToPrice(original, original.finalPrice - 40);

    expect(discounted.calculatedPrice).toBe(original.finalPrice);
    expect(discounted.finalPrice).toBeCloseTo(original.finalPrice - 40, 2);
    // Otherwise "Why this price?" reports the margin of a price nobody was sent.
    expect(discounted.marginPct).toBeLessThan(original.marginPct);
    expect(discounted.profit).toBeCloseTo(discounted.finalPrice - original.totalTrueCostInclOven, 2);
  });

  it('leaves the cost stack alone - discounting does not make the work cheaper', () => {
    const original = calculateQuote(threeBedHouse, settings);
    const discounted = rebaseBreakdownToPrice(original, original.finalPrice - 40);

    expect(discounted.totalTrueCostInclOven).toBe(original.totalTrueCostInclOven);
    expect(discounted.cleanerWageCost).toBe(original.cleanerWageCost);
    expect(discounted.chargeableHours).toBe(original.chargeableHours);
  });

  it('warns when a discount takes the margin below the review threshold', () => {
    const original = calculateQuote(threeBedHouse, settings);
    const atCost = rebaseBreakdownToPrice(original, original.totalTrueCostInclOven);

    expect(atCost.marginPct).toBeCloseTo(0, 4);
    expect(atCost.marginWarning).toBe('Below 25% - review before sending');
  });

  it('rebases contract value too, so a discounted visit does not overstate the contract', () => {
    const original = calculateQuote(
      { serviceType: 'commercial', estimatedHours: 3, condition: 'Standard', commercialFrequency: 'Weekly', addons: {} },
      settings
    );
    const discounted = rebaseBreakdownToPrice(original, original.finalPrice - 10);

    expect(discounted.weeklyContractValue).toBeCloseTo(discounted.finalPrice * 1, 2);
    expect(discounted.weeklyContractValue).toBeLessThan(original.weeklyContractValue);
  });

  it('is a no-op when the price has not moved', () => {
    const original = calculateQuote(threeBedHouse, settings);
    expect(rebaseBreakdownToPrice(original, original.finalPrice)).toBe(original);
  });
});
