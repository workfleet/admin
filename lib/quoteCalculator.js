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
  'Commercial Property': { bedroom: 0, bathroom: 0 },
};

export const PROPERTY_TYPES = Object.keys(PROPERTY_TYPE_DEFAULTS);

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

// input shape:
// {
//   propertyType, condition, cleanType, furnished, travelMiles,
//   rooms: { bedroom, bathroom, ensuite, kitchen, utility, living, dining, hallway, staircase, conservatory, garage },
//   addons: { hob: bool, hobQty, extractor: bool, extractorQty, mould: bool, mouldQty, ... },
//   oven: 'none' | 'single' | 'double',
// }
export function calculateQuote(input, settings) {
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

  const conditionMult = CONDITION_OPTIONS.find((c) => c.value === input.condition)?.multiplier ?? 1;
  const cleanTypeMult = CLEAN_TYPE_OPTIONS.find((c) => c.value === input.cleanType)?.multiplier ?? 1;
  const furnishedMult = FURNISHED_OPTIONS.find((f) => f.value === input.furnished)?.multiplier ?? 1;

  const totalAdjustedMinutes = (baseMinutes + addonMinutes) * conditionMult * cleanTypeMult * furnishedMult;
  const totalHours = Math.ceil(totalAdjustedMinutes / 60 / 0.5) * 0.5;
  const chargeableHours = Math.max(totalHours, Number(settings.minimum_callout_hours));

  const oven = OVEN_OPTIONS[input.oven] || OVEN_OPTIONS.none;

  const cleanerWageCost = chargeableHours * Number(settings.cleaner_hourly_pay);
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
  const finalPrice = Math.max(baseSellingPriceExclOven, Number(settings.minimum_job_price)) + oven.price;

  const profit = finalPrice - totalTrueCostInclOven;
  const marginPct = finalPrice > 0 ? profit / finalPrice : 0;
  const hourlyEquivalent = totalHours > 0 ? finalPrice / totalHours : 0;

  const pricePosition =
    hourlyEquivalent < 25 ? 'Very Competitive'
    : hourlyEquivalent <= 32 ? 'Competitive'
    : hourlyEquivalent <= 40 ? 'Premium'
    : 'Check price before sending';

  const marginWarning =
    marginPct < 0.25 ? 'Below 25% - review before sending'
    : marginPct <= 0.30 ? '25-30% - healthy margin'
    : 'Above 30% - strong margin';

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
    finalPrice: round2(finalPrice),
    profit: round2(profit),
    marginPct: round2(marginPct * 10000) / 10000,
    hourlyEquivalent: round2(hourlyEquivalent),
    pricePosition,
    marginWarning,
  };
}

export function defaultQuoteDescription(input, breakdown, address) {
  const cleanType = input.cleanType || 'clean';
  const where = address ? ` for the property at ${address}` : '';
  return `CrewConnect Cleaning will complete a professional ${cleanType}${where}. `
    + `The quote allows for approximately ${breakdown.totalHours.toFixed(1)} labour hours.`;
}
