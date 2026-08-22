'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Home, Calendar, User, HelpCircle, Settings, MessageCircle } from 'lucide-react';
import { getSessionAndProfile } from '../../lib/authGate';
import PresenceIndicator from '../components/PresenceIndicator';
import EmergencyButton from '../components/EmergencyButton';
import EnablePush from '../components/EnablePush';
import InstallPrompt from '../components/InstallPrompt';

const NAV_ITEMS = [
  { href: '/cleaner', label: 'Home', icon: Home },
  { href: '/cleaner/rota', label: 'Rota', icon: Calendar },
  { href: '/cleaner/messages', label: 'Messages', icon: MessageCircle },
  { href: '/cleaner/profile', label: 'Profile', icon: User },
  { href: '/cleaner/policies', label: 'Help', icon: HelpCircle },
  { href: '/cleaner/settings', label: 'Settings', icon: Settings },
];

export default function CleanerLayout({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
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

  return (
    <div className="cleaner-shell">
      <PresenceIndicator />
      <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 60, background: 'white', borderRadius: '50%', boxShadow: 'var(--shadow-md)' }}>
        <EnablePush />
      </div>
      <EmergencyButton />
      <InstallPrompt />
      {children}
      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => {
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
