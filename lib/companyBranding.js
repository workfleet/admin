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

// WorkFleet is the software the quote is produced in, not the business
// issuing it - so it appears as a discreet "prepared with" credit in the
// document furniture, never in place of CrewConnect's own identity.
export const PLATFORM = {
  name: 'WorkFleet',
  accent: '#EE7B45',
  ink: '#23262A',
  credit: 'Prepared with WorkFleet',
};

// The statutory footer every page of a quotation carries.
export function legalFooterLines() {
  const year = new Date().getFullYear();
  return [
    `© ${year} ${COMPANY.legalName.toUpperCase()}`,
    `${COMPANY.legalName} is registered in England and Wales.`,
    `Registered Office: ${COMPANY.registeredOffice}`,
    `Company Registration Number: ${COMPANY.companyNumber}.`,
  ];
}

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
