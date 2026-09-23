'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Home, Calendar, User, HelpCircle, Settings, MessageCircle, Package } from 'lucide-react';
import { getSessionAndProfile } from '../../lib/authGate';
import PresenceIndicator from '../components/PresenceIndicator';
import EmergencyButton from '../components/EmergencyButton';
import EnablePush from '../components/EnablePush';
import InstallPrompt from '../components/InstallPrompt';
import AutoCheckoutWatcher from '../components/AutoCheckoutWatcher';
import ShiftLocationWatcher from '../components/ShiftLocationWatcher';
import ClockQueueFlusher from '../components/ClockQueueFlusher';
import PhotoQueueFlusher from '../components/PhotoQueueFlusher';

const NAV_ITEMS = [
  { href: '/cleaner', label: 'Home', icon: Home },
  { href: '/cleaner/rota', label: 'Rota', icon: Calendar },
  { href: '/cleaner/messages', label: 'Messages', icon: MessageCircle, staffOnly: true },
  { href: '/cleaner/profile', label: 'Profile', icon: User },
  { href: '/cleaner/policies', label: 'Help', icon: HelpCircle, staffOnly: true },
  { href: '/cleaner/settings', label: 'Settings', icon: Settings },
];

// Whoever does the stock take is booked on the rota for it and clocks in
// like anyone else (lib/staffRoles.js), so this app is theirs too - it is
// where the shift and the clock live. They get a way back to the stock
// screens, and they lose the two things the database would hand them
// empty: Team Chat and the document/training library are gated on
// is_staff() (0021, 0035), which the inventory role is deliberately not in.
const INVENTORY_NAV_ITEM = { href: '/admin/inventory', label: 'Stock', icon: Package };

export default function CleanerLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    checkAccess();
  }, []);

  const checkAccess = async () => {
    setLoadError(false);
    const { session, profile, error } = await getSessionAndProfile();
    if (!session) { router.push('/'); return; }

    if (error) { setLoadError(true); return; }

    if (profile?.role === 'admin' || profile?.role === 'supervisor') { router.push('/admin'); return; }
    if (profile?.role === 'client') { router.push('/client'); return; }

    setRole(profile?.role || null);
    setAuthorized(true);
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

  const navItems = role === 'inventory'
    ? [...NAV_ITEMS.filter((item) => !item.staffOnly), INVENTORY_NAV_ITEM]
    : NAV_ITEMS;

  return (
    <div className="cleaner-shell">
      <PresenceIndicator />
      <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 60, background: 'white', borderRadius: '50%', boxShadow: 'var(--shadow-md)' }}>
        <EnablePush describe="shift updates and messages" />
      </div>
      <EmergencyButton />
      <InstallPrompt />
      {/* Two halves of the same job: AutoCheckoutWatcher takes one fix when
          the app is opened, ShiftLocationWatcher watches continuously while
          it is in front of them. Neither can see a locked phone. */}
      <AutoCheckoutWatcher />
      <ShiftLocationWatcher />
      {/* In the page flow, above whatever page is open, so a banner can
          never sit on top of a button - fixed to the bottom, the clock-in
          one covered Check Out. Empty (and zero height) when nothing is
          waiting. */}
      <div className="queue-banners">
        <ClockQueueFlusher />
        <PhotoQueueFlusher />
      </div>
      {children}
      <nav className="bottom-nav">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className={`bottom-nav-link ${active ? 'active' : ''}`}>
              <Icon size={20} strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
