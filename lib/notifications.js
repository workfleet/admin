import { supabase } from './supabaseClient';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// No scheduled job is set up for this project, so old notifications are
// purged lazily whenever a cleaner's notification list is loaded.
export async function purgeOldNotifications(userId) {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  await supabase.from('notifications').delete().eq('user_id', userId).lt('created_at', cutoff);
}
