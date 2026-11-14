import { describe, it, expect } from 'vitest';
import { titleForPath } from '../app/components/useDocumentTitle';

// The browser tab names each page after the menu item that opens it, or a
// known sub-page; anything else falls back to the shell's own default.
const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/payroll', label: 'Payroll' },
  { href: '/admin/cover', label: 'Shift cover' },
];

describe('titleForPath', () => {
  it('uses the menu label for a menu page', () => {
    expect(titleForPath('/admin', NAV)).toBe('Dashboard');
    expect(titleForPath('/admin/payroll', NAV)).toBe('Payroll');
    expect(titleForPath('/admin/cover', NAV)).toBe('Shift cover');
  });

  it('names known pages a level down', () => {
    expect(titleForPath('/admin/quotes/history', NAV)).toBe('Quote history');
    expect(titleForPath('/admin/audit', NAV)).toBe('Change log');
    expect(titleForPath('/cleaner/hours', [])).toBe('My hours');
  });

  it('names pages with an id in the address by what they show', () => {
    expect(titleForPath('/admin/clients/d31eacd9-4291-4d30-963c-9dd5204716dd', NAV)).toBe('Client');
    expect(titleForPath('/admin/cleaners/06f343e2-8f7e-4a73-8e22-adab780308c2', NAV)).toBe('Cleaner');
    expect(titleForPath('/cleaner/jobs/123', [])).toBe('Job');
    expect(titleForPath('/client/jobs/123', [])).toBe('Visit');
  });

  it('does not treat a deeper path as the page with the id', () => {
    expect(titleForPath('/admin/clients/abc/extra', NAV)).toBe(null);
  });

  it('returns null for an unknown page so the shell default applies', () => {
    expect(titleForPath('/admin/something-new', NAV)).toBe(null);
  });
});
