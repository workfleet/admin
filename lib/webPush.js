import webpush from 'web-push';

// Server-only: VAPID_PRIVATE_KEY has no NEXT_PUBLIC_ prefix on purpose,
// same reasoning as SUPABASE_SERVICE_ROLE_KEY - never read it in a
// 'use client' file. The public key is safe client-side; it's not a
// secret, just an identifier browsers use to verify push messages
// came from us.
const configured = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

if (configured) {
  webpush.setVapidDetails(
    'mailto:info@crewconnect.ltd',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export const pushConfigured = configured;

// Fire-and-forget per subscription: one dead/expired subscription
// should never block delivery to everyone else's phone. The caller is
// responsible for deleting subscriptions this reports as gone (410/404).
export async function sendPushToSubscriptions(subscriptions, payload) {
  if (!configured) return { sent: 0, gone: [] };

  const gone = [];
  let sent = 0;

  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) gone.push(sub.endpoint);
    }
  }));

  return { sent, gone };
}
