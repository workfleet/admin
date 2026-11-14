'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Calendar, Building2, Users, ClipboardList, FileText, MessageSquareWarning, MessageCircle, HelpCircle, ListChecks, ListTodo, PoundSterling, Download, Folder, Package, KeyRound, LifeBuoy, Banknote, Video, Bell, HardHat, Menu, X, Receipt, Megaphone } from 'lucide-react';
import { signOutAndClearPresence } from '../../lib/signOut';
import { getSessionAndProfile } from '../../lib/authGate';
import { canSeeInvoices } from '../../lib/invoiceAccess';
import PresenceIndicator from '../components/PresenceIndicator';
import ZoomControl from '../components/ZoomControl';
import EmergencyBanner from '../components/EmergencyBanner';
import EnablePush from '../components/EnablePush';
import Logo from '../components/Logo';
import { PageSkeleton, SkeletonNav } from '../components/Skeleton';
import { useDocumentTitle, titleForPath } from '../components/useDocumentTitle';

// Which placeholder shape the page is about to fill, so the shell's first
// frame already looks like the page that follows.
function skeletonFor(pathname) {
  if (pathname === '/admin') return 'dashboard';
  if (/^\/admin\/(clients|cleaners)\/[^/]+$/.test(pathname)) return 'detail';
  if (/^\/admin\/(payroll|invoices|audit|data-reports|quotes\/history|rota\/history)$/.test(pathname)) return 'table';
  return 'list';
}

// Cleaners/Onboarding manage staff accounts directly (adding, deactivating,
// reviewing onboarding ID documents) - kept admin-only, hidden from
// supervisors here and enforced again on those two pages themselves.
//
// Some people are in here for the stock screens and nothing else: the
// 'inventory' role (0101), and now anyone carrying the manages_inventory
// permission (0118) who is not office staff - a cleaner who also does the
// stock take. They land on Inventory and are bounced back to it from any
// other /admin page. RLS backs that up: products is the only table the
// permission opens, through can_manage_inventory().
//
// Their jobs live in the cleaner app, which is outside /admin and so outside
// the bounce; this is the way across to them.
const INVENTORY_HOME = '/admin/inventory';
const INVENTORY_JOBS_ITEM = { href: '/cleaner', label: 'My jobs', icon: Calendar };

// Grouped so the menu reads as four areas rather than one list of 23. Items
// with no group sit at the top; Help sits on its own at the bottom.
const NAV_GROUPS = [null, 'Work', 'Clients', 'People', 'Records', 'help'];

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, group: null },
  { href: '/admin/notifications', label: 'Notifications', icon: Bell, group: null },
  { href: '/admin/messages', label: 'Messages', icon: MessageCircle, group: null },
  { href: '/admin/announcements', label: 'Announcements', icon: Megaphone, group: null },

  { href: '/admin/rota', label: 'Rota', icon: Calendar, group: 'Work' },
  { href: '/admin/cover', label: 'Shift cover', icon: LifeBuoy, group: 'Work' },
  { href: '/admin/tasks', label: 'Team tasks', icon: ListTodo, group: 'Work' },
  { href: '/admin/requests', label: 'Requests', icon: MessageSquareWarning, group: 'Work' },

  { href: '/admin/clients', label: 'Clients', icon: Building2, group: 'Clients' },
  { href: '/admin/quotes', label: 'Quotes', icon: PoundSterling, group: 'Clients' },
  { href: '/admin/invoices', label: 'Invoices', icon: Receipt, adminOnly: true, invoicesOnly: true, group: 'Clients' },

  { href: '/admin/cleaners', label: 'Cleaners', icon: Users, adminOnly: true, group: 'People' },
  { href: '/admin/onboarding', label: 'Onboarding', icon: ClipboardList, adminOnly: true, group: 'People' },
  // Payroll figures have been admin-only since supervisors arrived (0035);
  // the page checks the role again itself.
  { href: '/admin/payroll', label: 'Payroll', icon: Banknote, adminOnly: true, group: 'People' },
  { href: '/admin/training', label: 'Training', icon: Video, group: 'People' },

  { href: '/admin/templates', label: 'Templates', icon: ListChecks, group: 'Records' },
  { href: '/admin/documents', label: 'Documents', icon: Folder, group: 'Records' },
  { href: '/admin/inventory', label: 'Inventory', icon: Package, group: 'Records' },
  { href: '/admin/keys', label: 'Key register', icon: KeyRound, group: 'Records' },
  // Injury details are health data: admins only since 0131.
  { href: '/admin/incidents', label: 'Accidents and incidents', icon: HardHat, adminOnly: true, group: 'Records' },
  { href: '/admin/reports', label: 'Reports', icon: FileText, group: 'Records' },
  { href: '/admin/data-reports', label: 'Data reports', icon: Download, group: 'Records' },

  { href: '/admin/help', label: 'Help', icon: HelpCircle, group: 'help' },
];

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState(null);
  // In here for the stock screens only - not office staff.
  const [stockOnly, setStockOnly] = useState(false);
  const [showInvoices, setShowInvoices] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useDocumentTitle(titleForPath(pathname, NAV_ITEMS) || 'Office');

  useEffect(() => {
    checkAccess();
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (stockOnly && pathname !== INVENTORY_HOME) router.replace(INVENTORY_HOME);
  }, [stockOnly, pathname]);

  const checkAccess = async () => {
    setLoadError(false);
    const { session, profile, error } = await getSessionAndProfile();
    if (!session) { router.push('/'); return; }

    if (error) { setLoadError(true); return; }

    // Deactivated while signed in: the server has banned their login, but
    // the access token in hand can outlive that by up to an hour. Turn them
    // away on this load rather than when it expires.
    if (profile?.active === false) { await signOutAndClearPresence(); router.push('/'); return; }

    const isOffice = profile?.role === 'admin' || profile?.role === 'supervisor';
    const isStock = profile?.role === 'inventory' || profile?.manages_inventory === true;
    if (!isOffice && !isStock) {
      router.push('/');
      return;
    }
    setRole(profile.role);
    setShowInvoices(canSeeInvoices(session));
    setStockOnly(!isOffice);
    setAuthorized(true);
  };

  const navItems = stockOnly
    ? [...NAV_ITEMS.filter((item) => item.href === INVENTORY_HOME), INVENTORY_JOBS_ITEM]
    : NAV_ITEMS.filter((item) => (!item.adminOnly || role === 'admin') && (!item.invoicesOnly || showInvoices));

  const handleLogout = async () => {
    await signOutAndClearPresence();
    router.push('/');
  };

  if (loadError) {
    return (
      <div className="container login-page">
        <p style={{ marginBottom: 12 }}>Couldn't load your account - please check your connection and try again.</p>
        <button onClick={checkAccess}>Retry</button>
      </div>
    );
  }

  // While the sign-in is checked: the shell with grey placeholders, instead
  // of a blank screen. No menu items yet - they depend on the role.
  if (!authorized) {
    return (
      <div className="admin-shell">
        <div className="admin-topbar">
          <div className="admin-topbar-brand">
            <Logo size={28} tone="light" showWordmark />
          </div>
        </div>
        <aside className="sidebar">
          <div className="sidebar-brand">
            <div className="sidebar-brand-lockup">
              <Logo size={30} tone="light" showWordmark />
              <div className="sidebar-brand-sub">Operations</div>
            </div>
          </div>
          <SkeletonNav />
        </aside>
        <main className="admin-main">
          <PageSkeleton variant={skeletonFor(pathname)} />
        </main>
      </div>
    );
  }

  return (
    <>
      <EmergencyBanner />
      <div className="admin-shell">
      <div className="admin-topbar">
        <div className="admin-topbar-brand">
          <Logo size={28} tone="light" showWordmark />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <EnablePush iconColor="white" />
          <PresenceIndicator iconColor="white" />
          <button type="button" className="admin-topbar-menu-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu" title="Open the menu">
            <Menu size={20} />
          </button>
        </div>
      </div>

      {drawerOpen && <div className="admin-drawer-overlay" onClick={() => setDrawerOpen(false)} />}

      <aside className={`sidebar ${drawerOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-brand-lockup">
            <Logo size={30} tone="light" showWordmark />
            <div className="sidebar-brand-sub">Operations</div>
          </div>
          <EnablePush />
          <PresenceIndicator />
          <button type="button" className="sidebar-close" onClick={() => setDrawerOpen(false)} aria-label="Close menu" title="Close the menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_GROUPS.map((group) => {
            const items = navItems.filter((item) => (item.group ?? null) === group);
            if (items.length === 0) return null;
            return (
              <div key={group ?? 'top'} className="sidebar-group">
                {group && group !== 'help' && <div className="sidebar-group-label">{group}</div>}
                {items.map((item) => {
                  const active = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`sidebar-link ${active ? 'active' : ''}`}
                    >
                      <Icon className="sidebar-icon" size={17} strokeWidth={1.9} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <ZoomControl />

        <button className="sidebar-logout" onClick={handleLogout}>
          Log out
        </button>
      </aside>

      <main className="admin-main">{children}</main>
      </div>
    </>
  );
}
