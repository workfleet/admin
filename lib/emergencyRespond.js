import { supabase } from './supabaseClient';
import { notify } from './notify';

// Shared between the admin banner and the location popup window, so
// "Respond" does the same thing (mark acknowledged, push-notify the
// cleaner) no matter which of the two an admin acts from.
export async function respondToEmergencyAlert(alertId, cleanerId) {
  const { data: { session } } = await supabase.auth.getSession();

  const { error } = await supabase
    .from('emergency_alerts')
    .update({ status: 'acknowledged', acknowledged_by: session.user.id, acknowledged_at: new Date().toISOString() })
    .eq('id', alertId);

  if (error) return { error };

  const { data: responderProfile } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).single();
  notify({ type: 'emergency_alert_acknowledged', cleanerId, responderName: responderProfile?.full_name || 'Admin' });

  return { error: null };
}
