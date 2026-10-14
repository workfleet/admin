// Invoices are for Jess's own login only - not the other admins, and not
// her second (iCloud) admin account (Jess, 2026-10-14). This hides the page
// and its menu link; other admins can still read the rota and client
// records the figures come from.
export const INVOICE_OWNER_EMAIL = 'jess@crewconnect.ltd';

export function canSeeInvoices(session) {
  return (session?.user?.email || '').toLowerCase() === INVOICE_OWNER_EMAIL;
}
