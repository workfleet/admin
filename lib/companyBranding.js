import { ADDON_TYPES, GARDEN_ADDON_TYPES, OVEN_OPTIONS } from './quoteCalculator';

export const COMPANY = {
  name: 'CrewConnect Cleaning',
  address: 'Penllergaer, Swansea, South Wales',
  phone: '07350 136763',
  email: 'info@crewconnect.ltd',
  website: 'crewconnect.ltd',
  brandColor: '#2fa5a9',
  brandColorDark: '#1e2526',
  // TODO: fill in the real Google Business (or Trustpilot) review link -
  // the client portal's post-rating review prompt hides itself while
  // this is null rather than link anywhere.
  googleReviewUrl: null,
};

export const QUOTE_NOTES = [
  'All cleaning materials supplied by CrewConnect Cleaning.',
  'Uniformed staff.',
  'Fully insured.',
  'Access and parking to be provided where possible.',
];

export function formatPriceGBP(price) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(price);
}

export function quoteReference(quote) {
  const date = new Date(quote.created_at);
  const y = String(date.getFullYear()).slice(2);
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `CC-${y}${m}${d}-${quote.id.slice(0, 6).toUpperCase()}`;
}

export function quoteRecipientName(quote) {
  return quote.client_id ? (quote.clients?.name || 'Client') : (quote.prospect_name || 'Prospect');
}

// A client-facing summary of what a calculator-generated quote covers -
// deliberately excludes wages, oncosts, true cost, and profit margin,
// which are internal figures that should never end up in a document sent
// to a client or prospect. Returns null for manually-entered quotes
// (no calculator_input/breakdown to summarise).
export function clientSafeBreakdown(quote) {
  const input = quote.calculator_input;
  const b = quote.calculator_breakdown;
  if (!input || !b) return null;

  const isGardening = input.serviceType === 'gardening';
  const isCommercial = input.serviceType === 'commercial';

  let items;
  if (isGardening) {
    items = [
      { label: 'Garden size', value: input.gardenSize },
      { label: 'Condition', value: input.condition },
      { label: 'Estimated labour', value: `${b.totalHours} hour${b.totalHours === 1 ? '' : 's'}` },
    ];
  } else if (isCommercial) {
    items = [
      { label: 'Frequency', value: input.commercialFrequency || 'One-off' },
      { label: 'Estimated labour per visit', value: `${b.totalHours} hour${b.totalHours === 1 ? '' : 's'}` },
    ];
    if (b.monthlyContractValue) {
      items.push({ label: 'Estimated monthly value', value: formatPriceGBP(b.monthlyContractValue) });
    }
  } else {
    items = [
      { label: 'Clean type', value: input.cleanType },
      { label: 'Property condition', value: input.condition },
      { label: 'Estimated labour', value: `${b.totalHours} hour${b.totalHours === 1 ? '' : 's'}` },
    ];
  }

  if (!isCommercial) {
    const extras = (isGardening ? GARDEN_ADDON_TYPES : ADDON_TYPES)
      .filter((a) => input.addons?.[a.key])
      .map((a) => a.label);
    if (extras.length > 0) items.push({ label: 'Extras included', value: extras.join(', ') });
  }

  if (!isGardening && !isCommercial && input.oven && input.oven !== 'none') {
    const oven = OVEN_OPTIONS[input.oven];
    items.push({ label: 'Oven clean', value: `${oven.label} (${formatPriceGBP(oven.price)})` });
  }

  if (Number(input.travelMiles) > 0) {
    items.push({ label: 'Travel', value: `${input.travelMiles} miles included` });
  }

  return items;
}
