// The shape of a client-facing quotation document.
//
// Both renderers (app/api/quotes/[id]/pdf and .../docx) walk the same
// block list, so the PDF and the Word version can't drift apart - only
// the drawing is duplicated, never the wording.
//
// Modelled on the Swansea Bus Station quotation: a numbered proposal
// (introduction, schedule, duties, RAMS/COSHH, pricing, acceptance)
// rather than a one-page price slip, because that's the format
// commercial buyers expect to put in front of a procurement panel.
//
// Block types a renderer must handle:
//   { type: 'para',    text }
//   { type: 'subhead', text }
//   { type: 'bullets', items: [string] }
//   { type: 'kv',      items: [{ label, value }] }
//   { type: 'price',   label, value }
//   { type: 'table',   columns: [string], rows: [[string]], strongLastRow }

import { COMPANY, QUOTE_NOTES, formatPriceGBP, quoteReference, quoteRecipientName } from './companyBranding';
import { ROOM_TYPES, ADDON_TYPES, GARDEN_ADDON_TYPES, OVEN_OPTIONS, STANDARD_INCLUSIONS, QUOTE_SEPARATELY_ITEMS } from './quoteCalculator';
import { summariseShiftSchedule } from './shiftSchedule';

const SERVICE_LABELS = {
  cleaning: 'Cleaning Services',
  commercial: 'Commercial Cleaning Services',
  gardening: 'Grounds & Gardening Services',
};

function formatDate(value) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatHours(hours) {
  const n = Number(hours);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 10) / 10;
  return `${rounded} hour${rounded === 1 ? '' : 's'}`;
}

// "Weekly", "Daily (5x/week)" and friends read as headings in the
// calculator, but mid-sentence they need lowercasing. "One-off" is the
// absence of a frequency, so it returns null rather than a phrase.
function frequencyPhrase(frequency) {
  if (!frequency || frequency === 'One-off') return null;
  return frequency.toLowerCase();
}

// "4-6 weeks" when a range was proposed, "4 weeks" when it's fixed.
function describeInitialWeeks(initialWeeks) {
  const min = Number(initialWeeks?.min) || 0;
  const max = Number(initialWeeks?.max) || 0;
  if (!min && !max) return null;
  if (min && max && min !== max) return `${min}-${max} weeks`;
  const weeks = min || max;
  return `${weeks} week${weeks === 1 ? '' : 's'}`;
}

export function quoteDocumentMeta(quote) {
  const input = quote.calculator_input || null;
  const schedule = summariseShiftSchedule(quote.shift_schedule);
  // A quote with a shift pattern is a staffed contract, so it reads as
  // commercial even when the room calculator was never opened.
  const serviceType = input?.serviceType || (schedule ? 'commercial' : 'cleaning');

  return {
    reference: quoteReference(quote),
    recipient: quoteRecipientName(quote),
    serviceType,
    serviceLabel: SERVICE_LABELS[serviceType] || SERVICE_LABELS.cleaning,
    siteAddress: input?.propertyAddress || quote.shift_schedule?.siteAddress || null,
    createdAt: formatDate(quote.created_at),
    validUntil: quote.valid_until ? formatDate(quote.valid_until) : null,
    contact: [quote.prospect_email, quote.prospect_phone].filter(Boolean).join(' · ') || null,
  };
}

// The "Prepared by / Service / Reference" strip under the QUOTATION title.
export function quoteSummaryLines(quote) {
  const meta = quoteDocumentMeta(quote);
  const b = quote.calculator_breakdown || null;
  const schedule = summariseShiftSchedule(quote.shift_schedule);
  const frequency = frequencyPhrase(quote.calculator_input?.commercialFrequency);

  const lines = [
    { label: 'Prepared by', value: COMPANY.name },
    { label: 'Prepared for', value: meta.recipient },
  ];
  if (meta.siteAddress) lines.push({ label: 'Site', value: meta.siteAddress });
  lines.push({ label: 'Service', value: meta.serviceLabel });
  if (frequency) lines.push({ label: 'Frequency', value: frequency.charAt(0).toUpperCase() + frequency.slice(1) });
  if (schedule) {
    lines.push({ label: 'Contracted hours', value: `${schedule.weeklyHours} hours per week` });
    const period = describeInitialWeeks(schedule.initialWeeks);
    if (period) lines.push({ label: 'Initial contract period', value: period });
  } else if (b?.visitsPerWeek) {
    lines.push({ label: 'Proposed pattern', value: `${b.visitsPerWeek} visit${b.visitsPerWeek === 1 ? '' : 's'} per week` });
  }
  lines.push({ label: 'Reference', value: meta.reference });
  lines.push({ label: 'Date', value: meta.createdAt });
  if (meta.validUntil) lines.push({ label: 'Valid until', value: meta.validUntil });
  if (meta.contact) lines.push({ label: 'Contact', value: meta.contact });

  return lines;
}

function introSection(quote, meta) {
  const where = meta.siteAddress ? ` at ${meta.siteAddress}` : ` for ${meta.recipient}`;
  const what = meta.serviceType === 'gardening' ? 'professional grounds and gardening services'
    : meta.serviceType === 'commercial' ? 'professional commercial cleaning services'
    : 'professional cleaning services';

  const blocks = [
    { type: 'para', text: `${COMPANY.name} is pleased to submit this quotation for the provision of ${what}${where}.` },
  ];

  if (meta.serviceType === 'commercial') {
    blocks.push({
      type: 'para',
      text: 'Our proposed service has been designed to provide consistent cleaning coverage across the agreed '
        + 'working pattern, ensuring the site is maintained to a high standard throughout the week.',
    });
  }

  blocks.push({
    type: 'para',
    text: 'We will provide appropriately trained operatives, materials and supervision required to deliver the agreed specification.',
  });

  return { title: 'Introduction', blocks };
}

function scopeSection(quote) {
  return { title: 'Scope of Works', blocks: [{ type: 'para', text: quote.description }] };
}

// Everything the calculator can say about the size and shape of the job,
// with the cost side (wages, oncosts, margin) deliberately left out -
// same rule as clientSafeBreakdown in companyBranding.js.
function serviceDetailSection(quote, meta) {
  const input = quote.calculator_input;
  const b = quote.calculator_breakdown;
  if (!input || !b) return null;

  const items = [];
  const blocks = [];

  if (meta.serviceType === 'gardening') {
    items.push({ label: 'Garden size', value: input.gardenSize });
    items.push({ label: 'Condition', value: input.condition });
  } else if (meta.serviceType === 'commercial') {
    items.push({ label: 'Frequency', value: input.commercialFrequency || 'One-off' });
    items.push({ label: 'Condition', value: input.condition });
  } else {
    items.push({ label: 'Property type', value: input.propertyType });
    items.push({ label: 'Clean type', value: input.cleanType });
    items.push({ label: 'Condition', value: input.condition });
    items.push({ label: 'Furnished', value: input.furnished });
  }

  const hours = formatHours(b.totalHours);
  if (hours) {
    items.push({
      label: meta.serviceType === 'commercial' ? 'Attendance per visit' : 'Estimated labour',
      value: hours,
    });
  }
  if (Number(input.travelMiles) > 0) {
    items.push({ label: 'Travel', value: `${input.travelMiles} miles included` });
  }

  blocks.push({ type: 'kv', items });

  const rooms = ROOM_TYPES
    .filter((r) => Number(input.rooms?.[r.key]) > 0)
    .map((r) => `${r.label} × ${input.rooms[r.key]}`);
  if (rooms.length > 0) {
    blocks.push({ type: 'subhead', text: 'Areas covered' });
    blocks.push({ type: 'bullets', items: rooms });
  }

  return { title: 'Service Detail', blocks };
}

// Sets the pattern out shift by shift, the way a buyer reads it off the
// page: heading, hours of attendance, the days it covers, weekly total.
function scheduleSection(schedule) {
  const blocks = [];

  schedule.weekly.forEach((pattern) => {
    blocks.push({ type: 'subhead', text: pattern.label || 'Cleaning shift' });
    blocks.push({ type: 'para', text: pattern.timeRange });
    blocks.push({ type: 'bullets', items: [pattern.daysDescription] });
    if (pattern.operatives > 1) {
      blocks.push({ type: 'para', text: `${pattern.operatives} operatives per shift.` });
    }
    blocks.push({ type: 'para', text: `Total: ${pattern.hoursPerWeek} hours per week` });
    if (pattern.note) blocks.push({ type: 'para', text: pattern.note });
  });

  schedule.occasional.forEach((pattern) => {
    const occasion = pattern.occasionLabel || 'occasion';
    blocks.push({ type: 'subhead', text: pattern.label || 'Additional cover' });
    blocks.push({ type: 'para', text: pattern.timeRange });
    if (pattern.operatives > 1) {
      blocks.push({ type: 'para', text: `${pattern.operatives} operatives per shift.` });
    }
    blocks.push({ type: 'para', text: `Total: ${pattern.hoursPerOccasion} hours per ${occasion}` });
    if (pattern.note) blocks.push({ type: 'para', text: pattern.note });
  });

  return { title: 'Proposed Cleaning Schedule', blocks };
}

function totalHoursSection(schedule) {
  return {
    title: 'Total Cleaning Hours',
    blocks: [
      { type: 'para', text: 'The standard weekly service provides:' },
      // Label first: lowercasing a user-typed label to fit it into a
      // sentence mangles "Monday to Friday daytime cleaning".
      { type: 'bullets', items: schedule.weekly.map(
        (p) => `${p.label || 'Cleaning'} - ${p.hoursPerWeek} hours`
      ) },
      { type: 'para', text: `Total: ${schedule.weeklyHours} cleaning hours per week` },
    ],
  };
}

const COMMERCIAL_DUTIES = [
  { subhead: 'Public areas', items: [
    'Sweeping floors',
    'Vacuuming where applicable',
    'Mopping hard floors',
    'Machine scrubbing of designated floor areas',
    'Spot cleaning',
    'Cleaning entrance, circulation and waiting areas',
  ] },
  { subhead: 'Toilets and washrooms', items: [
    'Cleaning and disinfecting toilets',
    'Cleaning sinks, wash basins and mirrors',
    'Cleaning floors and touch points',
    'Emptying sanitary and general waste bins',
    'Replenishing consumables where supplied or agreed',
  ] },
  { subhead: 'High-touch areas', items: [
    'Door handles and push plates',
    'Handrails',
    'Other frequently touched surfaces',
  ] },
  { subhead: 'Waste', items: [
    'Emptying general waste bins and replacing liners',
    'Removing waste to the agreed on-site waste location',
    'Reporting overflowing or problematic waste areas',
  ] },
];

const GARDENING_DUTIES = [
  { subhead: 'Grounds maintenance', items: [
    'Mowing and edging of lawned areas',
    'Weeding of borders and beds',
    'Pruning and general tidying',
    'Clearance of cuttings and debris from worked areas',
  ] },
];

function dutiesSection(quote, meta, schedule) {
  const input = quote.calculator_input;
  if (!input && !schedule) return null;

  const blocks = [{
    type: 'para',
    text: 'The proposed service will include, subject to the final site specification:',
  }];

  if (meta.serviceType === 'commercial') {
    COMMERCIAL_DUTIES.forEach((group) => {
      blocks.push({ type: 'subhead', text: group.subhead });
      blocks.push({ type: 'bullets', items: group.items });
    });
  } else if (meta.serviceType === 'gardening') {
    GARDENING_DUTIES.forEach((group) => {
      blocks.push({ type: 'subhead', text: group.subhead });
      blocks.push({ type: 'bullets', items: group.items });
    });
    const extras = GARDEN_ADDON_TYPES.filter((a) => input?.addons?.[a.key]).map((a) => a.label);
    if (extras.length > 0) {
      blocks.push({ type: 'subhead', text: 'Additional works included' });
      blocks.push({ type: 'bullets', items: extras });
    }
  } else {
    blocks.push({ type: 'subhead', text: 'Included as standard' });
    blocks.push({ type: 'bullets', items: STANDARD_INCLUSIONS });

    const extras = ADDON_TYPES.filter((a) => input?.addons?.[a.key]).map((a) => a.label);
    if (extras.length > 0) {
      blocks.push({ type: 'subhead', text: 'Additional works included' });
      blocks.push({ type: 'bullets', items: extras });
    }
    if (input?.oven && input.oven !== 'none') {
      blocks.push({ type: 'subhead', text: 'Oven cleaning' });
      blocks.push({ type: 'bullets', items: [`${OVEN_OPTIONS[input.oven].label} - included in the quoted price`] });
    }
    blocks.push({ type: 'subhead', text: 'Quoted separately on request' });
    blocks.push({ type: 'bullets', items: QUOTE_SEPARATELY_ITEMS });
  }

  return { title: meta.serviceType === 'gardening' ? 'Works Included' : 'Cleaning Duties', blocks };
}

function staffingSection() {
  return {
    title: 'Staffing',
    blocks: [
      { type: 'para', text: `${COMPANY.name} will provide suitably trained and competent operatives to undertake the agreed schedule.` },
      { type: 'para', text: 'Staff will be expected to:' },
      { type: 'bullets', items: [
        'Attend site at the agreed times',
        'Wear appropriate workwear and PPE',
        'Follow site rules and procedures',
        'Follow the agreed specification',
        'Use equipment safely',
        'Report hazards, defects and maintenance issues',
        'Maintain professional standards when working in occupied or public areas',
      ] },
      { type: 'para', text: `A suitable management and supervision structure will be maintained by ${COMPANY.name} throughout the contract.` },
    ],
  };
}

function ramsSection() {
  return {
    title: 'RAMS - Risk Assessments & Method Statements',
    blocks: [
      { type: 'para', text: `${COMPANY.name} will provide site-specific RAMS prior to commencement of the contract, covering the activities undertaken by our operatives, including where applicable:` },
      { type: 'bullets', items: [
        'General cleaning activities and floor cleaning',
        'Use of cleaning chemicals and COSHH controls',
        'Use of any powered cleaning equipment',
        'Manual handling',
        'Slips, trips and falls',
        'Working in an occupied or public environment',
        'PPE requirements',
        'Safe storage of equipment and chemicals',
        'Emergency procedures and the reporting of hazards and incidents',
      ] },
      { type: 'para', text: 'The RAMS will be reviewed with relevant staff before work commences, and updated where there are significant changes to the working environment, equipment or requirements.' },
    ],
  };
}

function coshhSection() {
  return {
    title: 'COSHH',
    blocks: [
      { type: 'para', text: `${COMPANY.name} will ensure that appropriate COSHH information is available for the chemicals used as part of the service. Operatives will be instructed in:` },
      { type: 'bullets', items: [
        'Safe chemical handling and correct dilution',
        'Appropriate PPE',
        'Safe storage and spill procedures',
        'Correct use of chemical products in line with manufacturer instructions',
      ] },
      { type: 'para', text: 'Only approved products will be used, in accordance with the agreed site requirements.' },
    ],
  };
}

function healthAndSafetySection() {
  return {
    title: 'Health & Safety',
    blocks: [
      { type: 'para', text: `${COMPANY.name} is committed to maintaining high standards of health and safety. All operatives are required to follow our health and safety procedures, site-specific rules, RAMS, COSHH procedures, safe systems of work and PPE requirements.` },
      { type: 'para', text: 'Wet floor signs and other appropriate warning measures will be used where necessary, with particular attention given to maintaining safe pedestrian routes while work is in progress.' },
    ],
  };
}

function qualitySection() {
  return {
    title: 'Quality Control',
    blocks: [
      { type: 'para', text: 'Quality standards will be maintained through:' },
      { type: 'bullets', items: [
        'Regular management oversight',
        'Staff supervision',
        'Documented on-site checks',
        'Review of the agreed specification',
        'Customer feedback and corrective action where required',
      ] },
      { type: 'para', text: `Any issues identified by the client will be addressed promptly and communicated to the appropriate ${COMPANY.name} management representative.` },
    ],
  };
}

function schedulePricingBlocks(schedule) {
  const blocks = [];

  if (schedule.weekly.length > 0) {
    blocks.push({
      type: 'table',
      columns: ['Service', 'Hours', 'Rate', 'Charge'],
      rows: [
        ...schedule.weekly.map((p) => [
          p.label || 'Cleaning',
          `${p.hoursPerWeek} hrs/week`,
          `${formatPriceGBP(p.rate)}/hr`,
          `${formatPriceGBP(p.weeklyCharge)}/week`,
        ]),
        ['Standard weekly service', `${schedule.weeklyHours} hrs/week`, '', `${formatPriceGBP(schedule.weeklyCharge)}/week`],
      ],
      strongLastRow: true,
    });
  }

  schedule.occasional.forEach((p) => {
    const occasion = p.occasionLabel || 'occasion';
    blocks.push({ type: 'subhead', text: p.label || 'Additional cover' });
    blocks.push({
      type: 'para',
      text: `${p.hoursPerOccasion} hours at ${formatPriceGBP(p.rate)} per hour - `
        + `${formatPriceGBP(p.chargePerOccasion)} per ${occasion}. Charged only when worked, `
        + 'in addition to the standard weekly charge.',
    });
  });

  return blocks;
}

function pricingSection(quote, meta, schedule) {
  const b = quote.calculator_breakdown;
  const blocks = [{ type: 'price', label: 'Quoted price', value: formatPriceGBP(quote.price) }];

  if (schedule) {
    blocks.push(...schedulePricingBlocks(schedule));
    blocks.push({ type: 'para', text: 'All prices are quoted in pounds sterling.' });
    return { title: 'Pricing', blocks };
  }

  if (b) {
    const hours = formatHours(b.totalHours);
    const rows = [];

    const ovenCharge = Number(b.ovenCharge) || 0;
    const labourPrice = Number(quote.price) - ovenCharge;
    const rate = Number(b.totalHours) > 0 ? formatPriceGBP(labourPrice / Number(b.totalHours)) : null;

    rows.push([
      meta.serviceType === 'gardening' ? 'Grounds maintenance' : 'Cleaning labour',
      [hours, rate ? `${rate} per hour` : null].filter(Boolean).join(' @ '),
      formatPriceGBP(labourPrice),
    ]);
    if (ovenCharge > 0) {
      rows.push([
        'Oven clean',
        OVEN_OPTIONS[quote.calculator_input?.oven]?.label || 'Oven clean',
        formatPriceGBP(ovenCharge),
      ]);
    }
    rows.push([
      meta.serviceType === 'commercial' && b.visitsPerWeek ? 'Total per visit' : 'Total',
      '',
      formatPriceGBP(quote.price),
    ]);

    blocks.push({ type: 'table', columns: ['Item', 'Detail', 'Amount'], rows, strongLastRow: true });
  }

  blocks.push({ type: 'para', text: 'All prices are quoted in pounds sterling.' });

  return { title: 'Pricing', blocks };
}

function scheduleContractValueSection(schedule) {
  const rows = [
    ['Per week', formatPriceGBP(schedule.weeklyCharge)],
    ...schedule.contractValues.map(({ weeks, value }) => [`${weeks} weeks`, formatPriceGBP(value)]),
  ];

  const blocks = [
    { type: 'para', text: 'Based on the standard weekly cleaning schedule:' },
    { type: 'table', columns: ['Contract period', 'Standard contract value'], rows },
  ];

  if (schedule.occasional.length > 0) {
    blocks.push({
      type: 'para',
      text: 'Ad-hoc shifts listed above are additional to these contract values and are charged only when worked.',
    });
  }

  return { title: 'Contract Value', blocks };
}

// Only meaningful once there's a recurring pattern to project the
// per-visit price into - a one-off clean has no contract value.
function contractValueSection(quote) {
  const b = quote.calculator_breakdown;
  if (!b?.visitsPerWeek || !b.weeklyContractValue) return null;

  return {
    title: 'Contract Value',
    blocks: [
      { type: 'para', text: 'Based on the proposed service pattern:' },
      { type: 'table', columns: ['Period', 'Value'], rows: [
        ['Per visit', formatPriceGBP(quote.price)],
        ['Per week', formatPriceGBP(b.weeklyContractValue)],
        ['Per month', formatPriceGBP(b.monthlyContractValue)],
      ] },
      { type: 'para', text: 'Contract values are indicative and based on the agreed visit pattern. Additional or ad-hoc attendances are charged separately.' },
    ],
  };
}

function materialsSection() {
  return {
    title: 'Equipment & Materials',
    blocks: [
      { type: 'para', text: `${COMPANY.name} will provide the standard equipment and materials required to carry out the agreed duties.` },
      { type: 'para', text: 'Any specialist equipment requested outside the agreed specification may be subject to an additional charge, subject to prior agreement. Where the client provides machinery for our operatives to use, servicing, repairs and mechanical faults remain the responsibility of the client unless otherwise agreed.' },
    ],
  };
}

function contractReviewSection(quote, schedule) {
  if (!schedule && !quote.calculator_breakdown?.visitsPerWeek) return null;
  return {
    title: 'Contract Review',
    blocks: [
      { type: 'para', text: (describeInitialWeeks(schedule?.initialWeeks)
        ? `The initial contract period is proposed as ${describeInitialWeeks(schedule.initialWeeks)}. `
        : '')
        + `During the initial period, ${COMPANY.name} will work with the client to establish the most effective routines, staffing requirements and frequencies.` },
      { type: 'para', text: 'Following the initial period, the service can be reviewed and continued under an agreed ongoing contract.' },
    ],
  };
}

function clientRequirementsSection() {
  return {
    title: 'Client Requirements',
    blocks: [
      { type: 'para', text: `To allow ${COMPANY.name} to deliver the service effectively, the client will be asked to provide:` },
      { type: 'bullets', items: [
        'Appropriate site access at the agreed times',
        'Access to the agreed working areas',
        'Suitable storage facilities for equipment where available',
        'Access to agreed water and waste disposal facilities',
        'Any relevant site-specific health and safety information',
        'Details of any restricted areas or operational requirements',
        'Parking where possible',
      ] },
    ],
  };
}

function acceptanceSection(quote, meta, schedule) {
  const b = quote.calculator_breakdown;
  const items = [{ label: 'Quoted price', value: formatPriceGBP(quote.price) }];
  if (schedule) {
    items.push({ label: 'Weekly charge', value: `${formatPriceGBP(schedule.weeklyCharge)} per week` });
    schedule.contractValues.forEach(({ weeks, value }) => {
      items.push({ label: `${weeks}-week value`, value: formatPriceGBP(value) });
    });
    schedule.occasional.forEach((p) => {
      items.push({
        label: p.label || 'Additional cover',
        value: `${formatPriceGBP(p.chargePerOccasion)} per ${p.occasionLabel || 'occasion'}`,
      });
    });
  } else if (b?.weeklyContractValue) {
    items.push({ label: 'Weekly value', value: formatPriceGBP(b.weeklyContractValue) });
    items.push({ label: 'Monthly value', value: formatPriceGBP(b.monthlyContractValue) });
  }
  if (meta.validUntil) items.push({ label: 'Valid until', value: meta.validUntil });

  return {
    title: 'Acceptance',
    blocks: [
      { type: 'para', text: `${COMPANY.name} would be pleased to provide the proposed service for ${meta.recipient}, and looks forward to working with you.` },
      { type: 'kv', items },
      { type: 'subhead', text: 'Notes' },
      { type: 'bullets', items: QUOTE_NOTES },
      { type: 'para', text: 'This quotation is based on the schedule and service requirements detailed within this document. To accept, please confirm in writing using the contact details shown above.' },
    ],
  };
}

// Assembles the document, drops the sections that don't apply to this
// quote, then numbers what's left - so the numbering never has gaps a
// client could read as a missing page.
export function quoteSections(quote) {
  const meta = quoteDocumentMeta(quote);
  const schedule = summariseShiftSchedule(quote.shift_schedule);
  const isCommercial = meta.serviceType === 'commercial';

  const sections = [
    introSection(quote, meta),
    scopeSection(quote),
    schedule ? scheduleSection(schedule) : null,
    schedule && schedule.weekly.length > 0 ? totalHoursSection(schedule) : null,
    serviceDetailSection(quote, meta),
    dutiesSection(quote, meta, schedule),
    staffingSection(),
    isCommercial ? ramsSection() : null,
    meta.serviceType === 'gardening' ? null : coshhSection(),
    healthAndSafetySection(),
    qualitySection(),
    pricingSection(quote, meta, schedule),
    schedule ? scheduleContractValueSection(schedule) : contractValueSection(quote),
    materialsSection(),
    contractReviewSection(quote, schedule),
    clientRequirementsSection(),
    acceptanceSection(quote, meta, schedule),
  ].filter(Boolean);

  return sections.map((section, i) => ({ ...section, number: i + 1 }));
}

export const QUOTE_STRAPLINE = 'Professional · Reliable · Safe · Consistent';
