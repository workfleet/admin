'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Calendar, Building2, Users, ClipboardList, FileText, MessageSquareWarning, MessageCircle, HelpCircle, ListChecks, ListTodo, PoundSterling, Download, Folder, Package, KeyRound, LifeBuoy, Menu, X } from 'lucide-react';
import { signOutAndClearPresence } from '../../lib/signOut';
import { getSessionAndProfile } from '../../lib/authGate';
import PresenceIndicator from '../components/PresenceIndicator';
import EmergencyBanner from '../components/EmergencyBanner';
import EnablePush from '../components/EnablePush';
import Logo from '../components/Logo';

// Cleaners/Onboarding manage staff accounts directly (adding, deactivating,
// reviewing onboarding ID documents) - kept admin-only, hidden from
// supervisors here and enforced again on those two pages themselves.
const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/rota', label: 'Rota', icon: Calendar },
  { href: '/admin/cover', label: 'Shift Cover', icon: LifeBuoy },
  { href: '/admin/clients', label: 'Clients', icon: Building2 },
  { href: '/admin/quotes', label: 'Quotes', icon: PoundSterling },
  { href: '/admin/cleaners', label: 'Cleaners', icon: Users, adminOnly: true },
  { href: '/admin/onboarding', label: 'Onboarding', icon: ClipboardList, adminOnly: true },
  { href: '/admin/templates', label: 'Templates', icon: ListChecks },
  { href: '/admin/documents', label: 'Documents', icon: Folder },
  { href: '/admin/inventory', label: 'Inventory', icon: Package },
  { href: '/admin/keys', label: 'Key Register', icon: KeyRound },
  { href: '/admin/tasks', label: 'Team Tasks', icon: ListTodo },
  { href: '/admin/reports', label: 'Reports', icon: FileText },
  { href: '/admin/data-reports', label: 'Data Reports', icon: Download },
  { href: '/admin/requests', label: 'Requests', icon: MessageSquareWarning },
  { href: '/admin/messages', label: 'Messages', icon: MessageCircle },
  { href: '/admin/help', label: 'Help', icon: HelpCircle },
];

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    checkAccess();
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const checkAccess = async () => {
    setLoadError(false);
    const { session, profile, error } = await getSessionAndProfile();
    if (!session) { router.push('/'); return; }

    if (error) { setLoadError(true); return; }

    if (profile?.role !== 'admin' && profile?.role !== 'supervisor') {
      router.push('/');
      return;
    }
    setRole(profile.role);
    setAuthorized(true);
  };

  const navItems = NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');

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

  if (!authorized) return null;

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
          <button type="button" className="admin-topbar-menu-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
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
          <button type="button" className="sidebar-close" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${active ? 'active' : ''}`}
              >
                <Icon className="sidebar-icon" size={18} strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button className="sidebar-logout" onClick={handleLogout}>
          Log out
        </button>
      </aside>

      <main className="admin-main">{children}</main>
      </div>
    </>
  );
}
