// Who the company is.
//
// COMPANY below is the fallback, not the source of truth: the live values
// come from the company_settings table (migration 0045) so a change of
// phone number or registered office doesn't need a deploy. These defaults
// are what renders if that row can't be read - better a slightly stale
// letterhead than a quote with holes in it.
export const COMPANY = {
  name: 'CrewConnect Cleaning',
  // The trading name above is what clients recognise; the registered
  // entity below is what has to appear on anything contractual, so
  // quotation documents carry both.
  legalName: 'CrewConnect RPO Ltd',
  registeredOffice: '164 Gorseinon Road, Penllergaer, Swansea, SA4 9AA',
  companyNumber: '16327874',
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

// The columns an admin can edit, paired with the key each one fills in on
// the company object. Drives both the merge below and the admin form, so
// adding a field is a one-line change in one place.
export const COMPANY_FIELDS = [
  { column: 'trading_name', key: 'name', label: 'Trading name' },
  { column: 'legal_name', key: 'legalName', label: 'Registered company name' },
  { column: 'company_number', key: 'companyNumber', label: 'Company number' },
  { column: 'registered_office', key: 'registeredOffice', label: 'Registered office' },
  { column: 'address', key: 'address', label: 'Address shown on documents' },
  { column: 'phone', key: 'phone', label: 'Phone' },
  { column: 'email', key: 'email', label: 'Email' },
  { column: 'website', key: 'website', label: 'Website' },
  { column: 'brand_color', key: 'brandColor', label: 'Brand colour (hex)' },
];

// A blank or whitespace-only column falls back rather than printing an
// empty letterhead - an admin clearing a field by accident shouldn't
// silently strip the company name off documents already going out.
export function companyFromSettings(row) {
  if (!row) return COMPANY;

  const merged = { ...COMPANY };
  for (const { column, key } of COMPANY_FIELDS) {
    const value = typeof row[column] === 'string' ? row[column].trim() : row[column];
    if (value) merged[key] = value;
  }
  return merged;
}

// WorkFleet is the software the quote is produced in, not the business
// issuing it - so it appears as a discreet "prepared with" credit in the
// document furniture, never in place of CrewConnect's own identity.
export const PLATFORM = {
  name: 'WorkFleet',
  // Route W palette - keep in step with app/brand.css. Coral is the
  // "where the cleaner is now" node in the mark, not decoration.
  accent: '#FF6B5B',
  ink: '#202327',
  credit: 'Prepared with WorkFleet',
};

// The statutory detail, as one footer line. It used to run as a four-line
// block at the top of every page - faithful to the Word original, but it
// competed with the content and pushed the price down the page. Nobody
// reads it; it just has to be present.
export function legalFooterLine(company = COMPANY) {
  return `${company.legalName} · Registered in England and Wales no. ${company.companyNumber}`
    + ` · Registered office: ${company.registeredOffice}`;
}

// Named rather than a constant because the first one carries the trading
// name, which is now editable.
export function quoteNotes(company = COMPANY) {
  return [
    `All cleaning materials supplied by ${company.name}.`,
    'Uniformed staff.',
    'Fully insured.',
    'Access and parking to be provided where possible.',
  ];
}

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
