'use client';

import { useEffect, useState } from 'react';
import { Siren } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { notify } from '../../lib/notify';
import { useConfirm } from './ConfirmProvider';
import { useToast } from './ToastProvider';

// Panic button for lone workers - always visible on every cleaner page
// (rendered once in the cleaner layout, not tied to a specific job) so
// it's reachable no matter what screen someone is on when they need it.
export default function EmergencyButton() {
  const confirm = useConfirm();
  const toast = useToast();
  const [userId, setUserId] = useState(null);
  const [sending, setSending] = useState(false);
  const [justSent, setJustSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setUserId(session.user.id);
    });
  }, []);

  const raiseAlert = async () => {
    if (!userId || sending) return;

    const ok = await confirm('Send an emergency alert to admin now? They will be notified immediately and should call you back.', {
      title: 'Emergency Alert',
      confirmLabel: 'Send Alert',
      danger: true,
    });
    if (!ok) return;

    setSending(true);
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).single();

    const { error } = await supabase.from('emergency_alerts').insert({ cleaner_id: userId });

    setSending(false);
    if (error) {
      toast.error('Could not send the alert - please call the office directly.');
      return;
    }

    notify({ type: 'emergency_alert', cleanerName: profile?.full_name || 'A cleaner' });

    toast.success('Alert sent to admin.');
    setJustSent(true);
    setTimeout(() => setJustSent(false), 30000);
  };

  if (!userId) return null;

  return (
    <button
      type="button"
      onClick={raiseAlert}
      disabled={sending}
      aria-label="Send emergency alert to admin"
      className="emergency-fab"
      title={justSent ? 'Alert sent - admin has been notified' : 'Emergency alert'}
    >
      <Siren size={20} />
      <span>{justSent ? 'Alert Sent' : 'EMERGENCY'}</span>
      {justSent && <span className="emergency-fab-badge" />}
    </button>
  );
}
