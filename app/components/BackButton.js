'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

// Pages the menu (office sidebar, cleaner bottom bar, client sidebar) opens
// directly. A "Back" link at the top of these read like a website rather
// than an app - the menu is the way around - so it hides itself there and
// stays on the pages a level down (a client, a cleaner, quote history...).
// Keep in step with NAV_ITEMS in app/admin, app/cleaner and app/client
// layout.js.
const MENU_PAGES = new Set([
  '/admin', '/admin/notifications', '/admin/messages', '/admin/announcements', '/admin/rota', '/admin/cover',
  '/admin/tasks', '/admin/requests', '/admin/clients', '/admin/quotes', '/admin/invoices',
  '/admin/cleaners', '/admin/onboarding', '/admin/payroll', '/admin/training',
  '/admin/templates', '/admin/documents', '/admin/inventory', '/admin/keys',
  '/admin/incidents', '/admin/insights', '/admin/reports', '/admin/data-reports', '/admin/help',
  '/cleaner', '/cleaner/rota', '/cleaner/messages', '/cleaner/profile',
  '/cleaner/policies', '/cleaner/settings',
  '/client', '/client/history', '/client/reports', '/client/documents',
  '/client/messages', '/client/contacts', '/client/settings', '/client/help',
]);

export default function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  if (MENU_PAGES.has(pathname)) return null;

  // Opened straight from a link (a notification, an email) there is no page
  // to go back to, and router.back() would leave the app - go up a level.
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(pathname.replace(/\/[^/]+$/, '') || '/');
  };

  return (
    <button type="button" onClick={goBack} className="back-button" aria-label="Go back" title="Go back to the previous page">
      <ArrowLeft size={16} /> Back
    </button>
  );
}
