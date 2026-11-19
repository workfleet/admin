'use client';

import { useEffect } from 'react';

// Names the browser tab after the page ("Payroll · WorkFleet") instead of
// every tab reading just "WorkFleet". The office and cleaner apps are
// WorkFleet; the client portal is CrewConnect's, so it passes that brand.
//
// The app shells set a name from the address; a page that knows something
// better once its data loads (a client's or cleaner's name) calls this
// again and wins, because its effect runs after the data arrives.
export function useDocumentTitle(title, brand = 'WorkFleet') {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · ${brand}`;
  }, [title, brand]);
}

// Titles for pages a level below the menus, keyed by exact path or by a
// pattern for pages with an id in the address.
const SUBPAGES = [
  ['/admin/quotes/history', 'Quote history'],
  ['/admin/quotes/wording', 'Quote wording'],
  ['/admin/rota/history', 'Job history'],
  ['/admin/reports/monthly', 'Monthly reports'],
  ['/admin/audit', 'Change log'],
  [/^\/admin\/clients\/[^/]+$/, 'Client'],
  [/^\/admin\/cleaners\/[^/]+$/, 'Cleaner'],
  ['/cleaner/hours', 'My hours'],
  ['/cleaner/invoices', 'Invoices'],
  ['/admin/subcontractor-invoices', 'Subcontractor invoices'],
  ['/cleaner/incidents', 'Accidents and incidents'],
  ['/cleaner/notifications', 'Notifications'],
  ['/cleaner/training', 'Training'],
  [/^\/cleaner\/training\/[^/]+$/, 'Training video'],
  [/^\/cleaner\/jobs\/[^/]+$/, 'Job'],
  [/^\/client\/jobs\/[^/]+$/, 'Visit'],
];

// The name for a path: the menu item that opens it, else a known sub-page.
export function titleForPath(pathname, navItems = []) {
  const item = navItems.find((i) => i.href === pathname);
  if (item) return item.label;
  for (const [match, title] of SUBPAGES) {
    if (typeof match === 'string' ? match === pathname : match.test(pathname)) return title;
  }
  return null;
}
