export const COMPANY = {
  name: 'CrewConnect Cleaning',
  address: 'Penllergaer, Swansea, South Wales',
  phone: '07350 136763',
  email: 'info@crewconnect.ltd',
  website: 'crewconnect.ltd',
  brandColor: '#2fa5a9',
  brandColorDark: '#1e2526',
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
