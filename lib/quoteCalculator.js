// Ported from the CrewConnect quoting spreadsheet (Quote Engine / Time
// Benchmarks / Add-ons / Pricing Settings tabs). Room-time benchmarks,
// multipliers, property-type defaults, and the add-on catalog are kept as
// code constants here - they define the calculator's shape, not its
// tunable numbers (those live in the pricing_settings table).

export const ROOM_TYPES = [
  { key: 'bedroom', label: 'Bedrooms', minutes: 35 },
  { key: 'bathroom', label: 'Bathrooms', minutes: 45 },
  { key: 'ensuite', label: 'Ensuites', minutes: 30 },
  { key: 'kitchen', label: 'Kitchens', minutes: 90 },
  { key: 'utility', label: 'Utility rooms', minutes: 25 },
  { key: 'living', label: 'Living rooms', minutes: 45 },
  { key: 'dining', label: 'Dining rooms', minutes: 30 },
  { key: 'hallway', label: 'Hallways / landings', minutes: 20 },
  { key: 'staircase', label: 'Staircases', minutes: 20 },
  { key: 'conservatory', label: 'Conservatories', minutes: 45 },
  { key: 'garage', label: 'Garages', minutes: 30 },
];

export const CONDITION_OPTIONS = [
  { value: 'Light', multiplier: 0.85 },
  { value: 'Standard', multiplier: 1.0 },
  { value: 'Heavy', multiplier: 1.3 },
  { value: 'Very Heavy', multiplier: 1.6 },
];

export const CLEAN_TYPE_OPTIONS = [
  { value: 'End of Tenancy', multiplier: 1.15 },
  { value: 'Post-Build Clean', multiplier: 1.35 },
  { value: 'Deep Clean', multiplier: 1.2 },
  { value: 'Pre-Let Clean', multiplier: 1.0 },
  { value: 'Pre-Sale Clean', multiplier: 1.1 },
  { value: 'Communal Area Clean', multiplier: 1.0 },
  { value: 'After Renovation Clean', multiplier: 1.3 },
];

export const FURNISHED_OPTIONS = [
  { value: 'No', multiplier: 1.0 },
  { value: 'Part Furnished', multiplier: 1.1 },
  { value: 'Yes', multiplier: 1.2 },
];

// Bedroom/bathroom defaults, auto-filled when a property type is picked -
// still hand-editable afterward for anything unusual (5+ becomes "type the
// exact number").
export const PROPERTY_TYPE_DEFAULTS = {
  'Studio': { bedroom: 0, bathroom: 1 },
  '1 Bed Flat': { bedroom: 1, bathroom: 1 },
  '2 Bed Flat': { bedroom: 2, bathroom: 1 },
  '3 Bed Flat': { bedroom: 3, bathroom: 1 },
  '4+ Bed Flat': { bedroom: 4, bathroom: 2 },
  '2 Bed House': { bedroom: 2, bathroom: 1 },
  '3 Bed House': { bedroom: 3, bathroom: 1 },
  '4 Bed House': { bedroom: 4, bathroom: 2 },
  '5+ Bed House': { bedroom: 5, bathroom: 2 },
  'HMO': { bedroom: 0, bathroom: 1 },
};

export const PROPERTY_TYPES = Object.keys(PROPERTY_TYPE_DEFAULTS);

export const SERVICE_TYPES = [
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'gardening', label: 'Gardening' },
];

// Commercial spaces vary too much for a room/size formula, so this is
// priced directly off an admin-entered hours estimate rather than a
// derived one - no condition/clean-type/furnished multipliers, since a
// human estimate already accounts for that.
//
// Frequency doesn't change the per-visit rate, only how it's projected
// into weekly/monthly contract value - but anything other than One-off
// makes the work recurring, which changes which minimums the visit is
// floored by (see calculateQuote).
export const COMMERCIAL_FREQUENCY_OPTIONS = [
  { value: 'One-off', visitsPerWeek: 0 },
  { value: 'Daily (5x/week)', visitsPerWeek: 5 },
  { value: 'A few times a week', visitsPerWeek: 3 },
  { value: 'Weekly', visitsPerWeek: 1 },
  { value: 'Fortnightly', visitsPerWeek: 0.5 },
  { value: 'Monthly', visitsPerWeek: 12 / 52 },
];

// No real job history to base this on yet - hours are averaged from UK
// gardening-service estimates (general maintenance: mowing, weeding,
// pruning, tidying) rather than CrewConnect's own data. Worth revisiting
// once there's enough real gardening job history to compare against.
export const GARDEN_SIZE_OPTIONS = [
  { value: 'Small (up to 100m²)', hours: 2.5 },
  { value: 'Medium (100-200m²)', hours: 4 },
  { value: 'Large (200-400m²)', hours: 6 },
  { value: 'Extra Large (400m²+)', hours: 8 },
];

// Same shape as ADDON_TYPES (cleaning), separate catalog since the jobs
// don't overlap.
export const GARDEN_ADDON_TYPES = [
  { key: 'hedgeTrimming', label: 'Hedge trimming', minutes: 45 },
  { key: 'weeding', label: 'Weeding (borders/beds)', minutes: 30 },
  { key: 'leafClearance', label: 'Leaf / seasonal clearance', minutes: 30 },
  { key: 'greenWasteRemoval', label: 'Green waste removal', minutes: 20 },
  { key: 'powerWashing', label: 'Patio/path power washing', minutes: 45 },
];

// Yes/No add-ons that add fixed minutes (qty defaults to 1, editable for
// the ones the sheet allows a quantity on).
export const ADDON_TYPES = [
  { key: 'hob', label: 'Hob clean extra', minutes: 15 },
  { key: 'extractor', label: 'Extractor clean extra', minutes: 20 },
  { key: 'mould', label: 'Mould cleaning', minutes: 30 },
  { key: 'limescale', label: 'Heavy limescale', minutes: 30 },
  { key: 'petHair', label: 'Pet hair', minutes: 30 },
  { key: 'parking', label: 'Parking difficulty', minutes: 15 },
  { key: 'noLift', label: 'No lift / upper floor', minutes: 15 },
  { key: 'keyCollection', label: 'Key collection required', minutes: 30 },
];

// Oven cleaning is a flat customer charge with a flat cleaner payout,
// entirely separate from the hourly-rate labour calculation.
export const OVEN_OPTIONS = {
  none: { label: 'None', price: 0, cleanerPay: 0 },
  single: { label: 'Single oven', price: 60, cleanerPay: 45 },
  double: { label: 'Double oven', price: 80, cleanerPay: 45 },
};

// Fridge, freezer, dishwasher, washing machine and internal windows/blinds
// are always-free standard inclusions - no extra time or charge, shown to
// the client as reassurance rather than as calculator inputs.
export const STANDARD_INCLUSIONS = [
  'Fridge clean', 'Freezer clean', 'Dishwasher clean', 'Washing machine clean', 'Internal windows & blinds',
];

// Not priced automatically - always flagged for a manual, separate quote
// once the admin has seen the property (matches the sheet's own approach).
export const QUOTE_SEPARATELY_ITEMS = ['Carpet cleaning', 'Upholstery cleaning', 'Rubbish removal'];

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Mirrors the default in migration 0071. Held here too because a setting
// added by a migration is absent from every row until that migration has
// actually run, and a missing column must not turn a quote into £NaN.
export const DEFAULT_COMMERCIAL_RECURRING_MIN_HOURS = 1.5;

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleaningMinutesAndMultipliers(input, settings) {
  const baseMinutes = ROOM_TYPES.reduce(
    (sum, r) => sum + (Number(input.rooms?.[r.key]) || 0) * r.minutes,
    0
  );

  const addonMinutes = ADDON_TYPES.reduce((sum, a) => {
    if (!input.addons?.[a.key]) return sum;
    const raw = input.addons?.[`${a.key}Qty`];
    // A deliberately-entered 0 must stay 0, not fall back to 1 - only an
    // actually-missing value (undefined/null/'') should default.
    const qty = raw === undefined || raw === null || raw === '' ? 1 : Number(raw);
    return sum + qty * a.minutes;
  }, 0);

  return {
    baseMinutes,
    addonMinutes,
    conditionMult: CONDITION_OPTIONS.find((c) => c.value === input.condition)?.multiplier ?? 1,
    cleanTypeMult: CLEAN_TYPE_OPTIONS.find((c) => c.value === input.cleanType)?.multiplier ?? 1,
    furnishedMult: FURNISHED_OPTIONS.find((f) => f.value === input.furnished)?.multiplier ?? 1,
    hourlyPay: Number(settings.cleaner_hourly_pay),
  };
}

// Garden size drives base hours directly rather than a room-by-room sum.
// Condition still applies (an overgrown garden takes longer); clean type
// and furnished status don't mean anything for gardening, so they're
// fixed at 1 rather than shown as inputs.
function gardeningMinutesAndMultipliers(input, settings) {
  const sizeOption = GARDEN_SIZE_OPTIONS.find((s) => s.value === input.gardenSize) || GARDEN_SIZE_OPTIONS[0];
  const baseMinutes = sizeOption.hours * 60;

  const addonMinutes = GARDEN_ADDON_TYPES.reduce((sum, a) => {
    if (!input.addons?.[a.key]) return sum;
    const raw = input.addons?.[`${a.key}Qty`];
    const qty = raw === undefined || raw === null || raw === '' ? 1 : Number(raw);
    return sum + qty * a.minutes;
  }, 0);

  return {
    baseMinutes,
    addonMinutes,
    conditionMult: CONDITION_OPTIONS.find((c) => c.value === input.condition)?.multiplier ?? 1,
    cleanTypeMult: 1,
    furnishedMult: 1,
    hourlyPay: Number(settings.gardener_hourly_pay),
  };
}

// No formula for this - commercial spaces vary too much by industry and
// layout, so the admin's own judgment on hours is the input. Condition
// still applies on top of that estimate (a neglected office takes
// longer than the same hours would suggest for a well-maintained one);
// clean type and furnished status don't mean anything here.
function commercialMinutesAndMultipliers(input, settings) {
  return {
    baseMinutes: (Number(input.estimatedHours) || 0) * 60,
    addonMinutes: 0,
    conditionMult: CONDITION_OPTIONS.find((c) => c.value === input.condition)?.multiplier ?? 1,
    cleanTypeMult: 1,
    furnishedMult: 1,
    hourlyPay: Number(settings.cleaner_hourly_pay),
  };
}

// Everything about a quote that depends on the price being charged
// rather than on the work being done, kept in one place so a
// hand-edited price can be run back through exactly the same reasoning
// (see rebaseBreakdownToPrice).
function priceDerivedFields({ finalPrice, totalTrueCostInclOven, chargeableHours, visitsPerWeek }) {
  const profit = finalPrice - totalTrueCostInclOven;
  const marginPct = finalPrice > 0 ? profit / finalPrice : 0;

  // Divided by the hours actually charged for, not the estimate. When
  // the minimum callout or the minimum job price is what sets the price,
  // dividing by a shorter estimate invents a rate nobody is paying: a
  // one-hour commercial visit at the £120 floor is £40/hr across the
  // three-hour minimum, not £120/hr, and an empty form is £40/hr rather
  // than the £0/hr that used to read as "Very Competitive".
  const hourlyEquivalent = chargeableHours > 0 ? finalPrice / chargeableHours : 0;

  const pricePosition =
    hourlyEquivalent < 25 ? 'Very Competitive'
    : hourlyEquivalent <= 32 ? 'Competitive'
    : hourlyEquivalent <= 40 ? 'Premium'
    : 'Check price before sending';

  const marginWarning =
    marginPct < 0.25 ? 'Below 25% - review before sending'
    : marginPct <= 0.30 ? '25-30% - healthy margin'
    : 'Above 30% - strong margin';

  const weeklyContractValue = visitsPerWeek === null ? null : round2(finalPrice * visitsPerWeek);
  const monthlyContractValue = visitsPerWeek === null ? null : round2(weeklyContractValue * (52 / 12));

  return {
    finalPrice: round2(finalPrice),
    profit: round2(profit),
    marginPct: round2(marginPct * 10000) / 10000,
    hourlyEquivalent: round2(hourlyEquivalent),
    pricePosition,
    marginWarning,
    visitsPerWeek,
    weeklyContractValue,
    monthlyContractValue,
  };
}

// input shape:
// {
//   serviceType: 'cleaning' | 'commercial' | 'gardening',
//   condition, travelMiles,
//   // cleaning only:
//   propertyType, cleanType, furnished,
//   rooms: { bedroom, bathroom, ensuite, kitchen, utility, living, dining, hallway, staircase, conservatory, garage },
//   oven: 'none' | 'single' | 'double',
//   // commercial only:
//   estimatedHours, commercialFrequency,
//   // gardening only:
//   gardenSize,
//   // cleaning + gardening only (different catalogs - see ADDON_TYPES / GARDEN_ADDON_TYPES):
//   addons: { <key>: bool, <key>Qty, ... },
// }
export function calculateQuote(input, settings) {
  const isGardening = input.serviceType === 'gardening';
  const isCommercial = input.serviceType === 'commercial';
  const { baseMinutes, addonMinutes, conditionMult, cleanTypeMult, furnishedMult, hourlyPay } = isGardening
    ? gardeningMinutesAndMultipliers(input, settings)
    : isCommercial
    ? commercialMinutesAndMultipliers(input, settings)
    : cleaningMinutesAndMultipliers(input, settings);

  // Frequency doesn't change the per-visit price - it projects that
  // price into a recurring contract value, since that's how commercial
  // cleaning is sold ("£45/visit, 3x/week"). It is read here rather than
  // at the bottom because whether the work recurs decides which minimums
  // apply below.
  const frequency = isCommercial
    ? COMMERCIAL_FREQUENCY_OPTIONS.find((f) => f.value === input.commercialFrequency) || COMMERCIAL_FREQUENCY_OPTIONS[0]
    : null;
  const isRecurringCommercial = Boolean(frequency && frequency.visitsPerWeek > 0);

  const totalAdjustedMinutes = (baseMinutes + addonMinutes) * conditionMult * cleanTypeMult * furnishedMult;
  const totalHours = Math.ceil(totalAdjustedMinutes / 60 / 0.5) * 0.5;
  // A standing contract doesn't re-incur what the one-off minimums pay
  // for - mobilising a cleaner to an unfamiliar property, and the risk of
  // not filling the rest of the day. Applied per visit they compound into
  // nonsense, so recurring commercial work is floored only by the
  // shortest visit worth dispatching someone for. One-off commercial is
  // still a one-off job and keeps the full minimums.
  const minHours = isRecurringCommercial
    ? numberOr(settings.commercial_recurring_min_hours, DEFAULT_COMMERCIAL_RECURRING_MIN_HOURS)
    : Number(settings.minimum_callout_hours);
  const chargeableHours = Math.max(totalHours, minHours);

  const oven = (isGardening || isCommercial) ? OVEN_OPTIONS.none : (OVEN_OPTIONS[input.oven] || OVEN_OPTIONS.none);

  const cleanerWageCost = chargeableHours * hourlyPay;
  const holidayCost = cleanerWageCost * Number(settings.holiday_allowance_pct);
  const niCost = cleanerWageCost * Number(settings.employer_ni_pct);
  const pensionCost = cleanerWageCost * Number(settings.pension_pct);
  const laborSubtotal = cleanerWageCost + holidayCost + niCost + pensionCost;
  const materialsCost = laborSubtotal * Number(settings.materials_pct);
  const adminCost = laborSubtotal * Number(settings.admin_pct);
  const travelCost = (Number(input.travelMiles) || 0) * Number(settings.travel_cost_per_mile);

  const costExclOven = laborSubtotal + materialsCost + adminCost + travelCost;
  const totalTrueCostInclOven = costExclOven + oven.cleanerPay;
  const baseSellingPriceExclOven = costExclOven / (1 - Number(settings.target_margin_pct));
  // The minimum job price is the other half of the one-off assumption -
  // it prices a visit as a job worth turning up for. A contract visit
  // isn't a job on its own, so recurring commercial work carries the
  // cost-plus price as-is and is floored on hours only.
  const flooredPrice = isRecurringCommercial
    ? baseSellingPriceExclOven
    : Math.max(baseSellingPriceExclOven, Number(settings.minimum_job_price));
  const finalPrice = flooredPrice + oven.price;

  const derived = priceDerivedFields({
    finalPrice,
    totalTrueCostInclOven,
    chargeableHours,
    visitsPerWeek: frequency?.visitsPerWeek ?? null,
  });

  return {
    baseMinutes,
    addonMinutes,
    totalAdjustedMinutes: round2(totalAdjustedMinutes),
    totalHours,
    chargeableHours,
    ovenCharge: oven.price,
    ovenCleanerPay: oven.cleanerPay,
    cleanerWageCost: round2(cleanerWageCost),
    holidayCost: round2(holidayCost),
    niCost: round2(niCost),
    pensionCost: round2(pensionCost),
    materialsCost: round2(materialsCost),
    adminCost: round2(adminCost),
    travelCost: round2(travelCost),
    totalTrueCostInclOven: round2(totalTrueCostInclOven),
    baseSellingPriceExclOven: round2(baseSellingPriceExclOven),
    ...derived,
  };
}

// A quote's price stays editable after the calculator has run - the
// admin discounts it, rounds it, or matches a competitor. The cost stack
// above is unaffected by that, but profit, margin, the hourly rate and
// both advisory labels only mean anything against the price actually
// being charged. Recompute them before the breakdown is stored, or
// "Why this price?" reports the margin of a price nobody was sent.
//
// The calculator's own answer is kept as calculatedPrice so the gap
// between "what it worked out" and "what we quoted" stays visible.
export function rebaseBreakdownToPrice(breakdown, price) {
  if (!breakdown) return breakdown;
  const quoted = Number(price);
  if (!Number.isFinite(quoted) || quoted === breakdown.finalPrice) return breakdown;

  return {
    ...breakdown,
    calculatedPrice: breakdown.calculatedPrice ?? breakdown.finalPrice,
    ...priceDerivedFields({
      finalPrice: quoted,
      totalTrueCostInclOven: breakdown.totalTrueCostInclOven,
      chargeableHours: breakdown.chargeableHours,
      visitsPerWeek: breakdown.visitsPerWeek,
    }),
  };
}

export function defaultQuoteDescription(input, breakdown, address) {
  const where = address ? ` for the property at ${address}` : '';

  if (input.serviceType === 'gardening') {
    return `CrewConnect Cleaning will complete a gardening visit${where}. `
      + `The quote allows for approximately ${breakdown.totalHours.toFixed(1)} labour hours.`;
  }

  if (input.serviceType === 'commercial') {
    const freq = input.commercialFrequency && input.commercialFrequency !== 'One-off'
      ? ` (${input.commercialFrequency.toLowerCase()})`
      : '';
    return `CrewConnect Cleaning will complete a commercial clean${where}${freq}. `
      + `The quote allows for approximately ${breakdown.totalHours.toFixed(1)} labour hours per visit.`;
  }

  const cleanType = input.cleanType || 'clean';
  return `CrewConnect Cleaning will complete a professional ${cleanType}${where}. `
    + `The quote allows for approximately ${breakdown.totalHours.toFixed(1)} labour hours.`;
}
