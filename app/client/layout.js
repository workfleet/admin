'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, History, MessageCircle, FileText, HelpCircle, Settings, Phone, LogOut, Menu, X, ClipboardList, ClipboardCheck, Receipt, DoorOpen } from 'lucide-react';
import EnablePush from '../components/EnablePush';
import { getSessionAndProfile } from '../../lib/authGate';
import { supabase } from '../../lib/supabaseClient';
import { signOutAndClearPresence } from '../../lib/signOut';
import { PageSkeleton, SkeletonNav } from '../components/Skeleton';
import { useDocumentTitle, titleForPath } from '../components/useDocumentTitle';

const NAV_ITEMS = [
  { href: '/client', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/client/history', label: 'History', icon: History },
  // Only for clients with detailed reports switched on (0122).
  { href: '/client/reports', label: 'Reports', icon: ClipboardList, detailedOnly: true },
  // Proof of service for every client, and quotes to accept (0148).
  { href: '/client/service-record', label: 'Service record', icon: ClipboardCheck },
  // Only for clients with a property whose rooms are tracked (0150).
  { href: '/client/rooms', label: 'Rooms', icon: DoorOpen, roomsOnly: true },
  { href: '/client/quotes', label: 'Quotes', icon: Receipt },
  { href: '/client/documents', label: 'Documents', icon: FileText },
  { href: '/client/messages', label: 'Messages', icon: MessageCircle },
  { href: '/client/contacts', label: 'Contacts', icon: Phone },
  { href: '/client/settings', label: 'Settings', icon: Settings },
  { href: '/client/help', label: 'Help', icon: HelpCircle },
];

export default function ClientLayout({ children }) {
  const pathname = usePathname();
  // The portal is CrewConnect's, so its tabs carry CrewConnect's name.
  useDocumentTitle(titleForPath(pathname, NAV_ITEMS) || 'Client portal', 'CrewConnect');
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailedReports, setDetailedReports] = useState(false);
  const [hasRooms, setHasRooms] = useState(false);
  // Replies from the office the client hasn't opened yet, shown on the
  // Messages link and as a dot on the phone menu button.
  const [myClientId, setMyClientId] = useState(null);
  const [unread, setUnread] = useState(0);

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

    // Deactivated while signed in: the server has banned their login, but
    // the access token in hand can outlive that by up to an hour. Turn them
    // away on this load rather than when it expires.
    if (profile?.active === false) { await signOutAndClearPresence(); router.push('/'); return; }

    if (profile?.role === 'admin' || profile?.role === 'supervisor') { router.push('/admin'); return; }
    if (profile?.role === 'inventory') { router.push('/admin/inventory'); return; }
    if (profile?.role === 'cleaner') { router.push('/cleaner'); return; }

    setAuthorized(true);

    // Not part of the access check: if this read fails the menu just
    // goes without the Reports link.
    const { data: own } = await supabase.from('profiles').select('client_id').eq('id', session.user.id).single();
    if (own?.client_id) {
      setMyClientId(own.client_id);
      const [{ data: client }, { count: tracked }] = await Promise.all([
        supabase.from('clients').select('detailed_reports').eq('id', own.client_id).single(),
        supabase.from('properties').select('id', { count: 'exact', head: true }).eq('client_id', own.client_id).not('rooms_tracked_since', 'is', null),
      ]);
      setDetailedReports(!!client?.detailed_reports);
      setHasRooms((tracked || 0) > 0);
    }
  };

  const countUnread = async () => {
    if (!myClientId) return;
    // Opening Messages marks them read; don't show a count there.
    if (pathname === '/client/messages') { setUnread(0); return; }
    const { count } = await supabase
      .from('client_messages')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', myClientId)
      .eq('sender', 'admin')
      .eq('read_by_client', false);
    setUnread(count || 0);
  };

  useEffect(() => {
    countUnread();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') countUnread();
    }, 60000);
    return () => clearInterval(timer);
  }, [myClientId, pathname]);

  const logout = async () => {
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

  // The portal's frame with grey placeholders while the sign-in is checked,
  // instead of a blank page.
  if (!authorized) {
    return (
      <div className="client-shell-layout">
        <div className="client-topbar">
          <div className="client-topbar-brand">
            <img src="/crewconnect-mark.png" alt="" className="client-brand-mark" width={34} height={34} />
            <div className="sidebar-brand-name">CrewConnect</div>
          </div>
        </div>
        <aside className="client-sidebar">
          <div className="sidebar-brand">
            <img src="/crewconnect-mark.png" alt="" className="client-brand-mark" width={34} height={34} />
            <div>
              <div className="sidebar-brand-name">CrewConnect</div>
              <div className="sidebar-brand-sub">Client Portal</div>
            </div>
          </div>
          <SkeletonNav rows={9} />
        </aside>
        <main className="client-main">
          <PageSkeleton className="" variant={pathname === '/client' ? 'dashboard' : 'list'} rows={3} />
        </main>
      </div>
    );
  }

  return (
    <div className="client-shell-layout">
      <div className="client-topbar">
        <div className="client-topbar-brand">
          <img src="/crewconnect-mark.png" alt="" className="client-brand-mark" width={34} height={34} />
          <div className="sidebar-brand-name">CrewConnect</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Arrival and departure alerts reach the phone only once the
              client has enabled notifications here (0090). */}
          <EnablePush iconColor="white" describe="your cleaner arriving and finishing" />
          <button type="button" className="client-topbar-menu-btn" onClick={() => setDrawerOpen(true)} aria-label={unread > 0 ? `Open menu - ${unread} unread message${unread === 1 ? '' : 's'}` : 'Open menu'} title="Open the menu" style={{ position: 'relative' }}>
            <Menu size={20} />
            {unread > 0 && <span className="client-menu-dot" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {drawerOpen && <div className="client-drawer-overlay" onClick={() => setDrawerOpen(false)} />}

      <aside className={`client-sidebar ${drawerOpen ? 'client-sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <img src="/crewconnect-mark.png" alt="" className="client-brand-mark" width={34} height={34} />
          <div>
            <div className="sidebar-brand-name">CrewConnect</div>
            <div className="sidebar-brand-sub">Client Portal</div>
          </div>
          <button type="button" className="client-sidebar-close" onClick={() => setDrawerOpen(false)} aria-label="Close menu" title="Close the menu">
            <X size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.filter((item) => (!item.detailedOnly || detailedReports) && (!item.roomsOnly || hasRooms)).map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={`sidebar-link ${active ? 'active' : ''}`}>
                <Icon className="sidebar-icon" size={18} strokeWidth={2} />
                {item.label}
                {item.href === '/client/messages' && unread > 0 && (
                  <span className="client-nav-count" aria-label={`${unread} unread`}>{unread}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <button className="sidebar-logout" onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <LogOut size={15} /> Log out
        </button>
      </aside>

      <main className="client-main">{children}</main>
    </div>
  );
}
