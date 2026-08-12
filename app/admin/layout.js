'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, Calendar, Building2, Users, ClipboardList, FileText, MessageSquareWarning, MessageCircle, HelpCircle, ListChecks, Menu, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

const NAV_ITEMS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/rota', label: 'Rota', icon: Calendar },
  { href: '/admin/clients', label: 'Clients', icon: Building2 },
  { href: '/admin/cleaners', label: 'Cleaners', icon: Users },
  { href: '/admin/onboarding', label: 'Onboarding', icon: ClipboardList },
  { href: '/admin/templates', label: 'Templates', icon: ListChecks },
  { href: '/admin/reports', label: 'Reports', icon: FileText },
  { href: '/admin/requests', label: 'Requests', icon: MessageSquareWarning },
  { href: '/admin/messages', label: 'Messages', icon: MessageCircle },
  { href: '/admin/help', label: 'Help', icon: HelpCircle },
];

export default function AdminLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    checkAccess();
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const checkAccess = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/'); return; }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .single();

    if (profile?.role !== 'admin') {
      router.push('/');
      return;
    }
    setAuthorized(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  if (!authorized) return null;

  return (
    <div className="admin-shell">
      <div className="admin-topbar">
        <div className="admin-topbar-brand">
          <div className="sidebar-logo">WF</div>
          <div className="sidebar-brand-name">Workfleet</div>
        </div>
        <button type="button" className="admin-topbar-menu-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>
      </div>

      {drawerOpen && <div className="admin-drawer-overlay" onClick={() => setDrawerOpen(false)} />}

      <aside className={`sidebar ${drawerOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="sidebar-logo">WF</div>
          <div>
            <div className="sidebar-brand-name">Workfleet</div>
            <div className="sidebar-brand-sub">Operations</div>
          </div>
          <button type="button" className="sidebar-close" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
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
  );
}
