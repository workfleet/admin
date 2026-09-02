#!/usr/bin/env node
// Mints a real user session for a named account, without a password.
//
// The end-to-end test is only worth running against real RLS - as postgres
// in the SQL editor, auth.uid() is null and every policy is bypassed, so a
// green run would prove nothing. But that means real logins, and typing staff
// passwords into a terminal to test with is a worse habit than the bug being
// tested for.
//
// So this asks the service role for a magic link and redeems it immediately.
// The result is an ordinary user access token: RLS cannot tell it from one
// issued at a login screen, which is exactly why it is useful here.
//
// This is an administrative capability and should be treated as one. It can
// mint a session for ANY account in the project, so run it deliberately, on
// accounts you have a reason to act as, and never leave the printed tokens
// lying around - they are live sessions until they expire.
//
// Usage:
//   node scripts/mint-test-tokens.js admin@example.com cleaner@example.com
//
// Prints shell exports for scripts/missed-clockin-e2e.js.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
loadEnvLocal();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const [adminEmail, cleanerEmail] = process.argv.slice(2);
if (!URL || !ANON || !SERVICE) {
  console.error('Missing Supabase env (URL / anon key / service role key) in .env.local');
  process.exit(1);
}
if (!adminEmail || !cleanerEmail) {
  console.error('Usage: node scripts/mint-test-tokens.js <admin-email> <cleaner-email>');
  process.exit(1);
}

async function mint(email) {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkError) throw new Error(`generateLink failed for ${email}: ${linkError.message}`);

  const hashed = link?.properties?.hashed_token;
  if (!hashed) throw new Error(`no hashed_token returned for ${email}`);

  // Redeemed through the anon client, the way a browser would, so what comes
  // back is a normal user session rather than anything privileged.
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: session, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: hashed,
    type: 'magiclink',
  });
  if (verifyError) throw new Error(`verifyOtp failed for ${email}: ${verifyError.message}`);
  if (!session?.session?.access_token) throw new Error(`no session returned for ${email}`);

  return { token: session.session.access_token, userId: session.user.id };
}

(async () => {
  const admin = await mint(adminEmail);
  const cleaner = await mint(cleanerEmail);

  console.log(`export TEST_ADMIN_TOKEN='${admin.token}'`);
  console.log(`export TEST_ADMIN_ID='${admin.userId}'`);
  console.log(`export TEST_CLEANER_TOKEN='${cleaner.token}'`);
  console.log(`export TEST_CLEANER_ID='${cleaner.userId}'`);
})().catch((err) => {
  console.error('Could not mint tokens:', err.message);
  process.exit(1);
});
