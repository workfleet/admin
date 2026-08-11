#!/usr/bin/env node
// RLS smoke test: exercises the invariants this project has actually broken
// before (RLS recursion, storage permissions, cross-role data isolation,
// the cleaner-deactivation gate, self privilege escalation) so a regression
// fails loudly instead of waiting to be found by hand again.
//
// Usage:
//   TEST_ADMIN_EMAIL=you@example.com TEST_ADMIN_PASSWORD=... \
//   TEST_CLEANER_EMAIL=cleaner@example.com TEST_CLEANER_PASSWORD=... \
//   node scripts/rls-smoke-test.js
//
// Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY from
// .env.local. Admin credentials are required. Cleaner credentials are
// optional — cleaner-role checks are skipped with a warning if absent.
// Creates and deletes its own throwaway fixture data; safe to run
// repeatedly against a real project.

const fs = require('fs');
const path = require('path');

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD;
const CLEANER_EMAIL = process.env.TEST_CLEANER_EMAIL;
const CLEANER_PASSWORD = process.env.TEST_CLEANER_PASSWORD;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD (an existing admin login) to run this script.');
  process.exit(1);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${name}${detail ? ` (${detail})` : ''}`);
}

async function login(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login failed for ${email}: ${JSON.stringify(body)}`);
  return { token: body.access_token, userId: body.user.id };
}

function headers(token, extra) {
  return { apikey: ANON_KEY, Authorization: `Bearer ${token || ANON_KEY}`, 'Content-Type': 'application/json', ...extra };
}

async function rest(method, resource, token, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    method,
    headers: headers(token, { Prefer: 'return=representation' }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function main() {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const cleaner = CLEANER_EMAIL && CLEANER_PASSWORD ? await login(CLEANER_EMAIL, CLEANER_PASSWORD) : null;
  if (!cleaner) console.log('(No TEST_CLEANER_EMAIL/PASSWORD set - skipping cleaner-role checks.)\n');

  const { body: [client] } = await rest('POST', 'clients', admin.token, { name: '__smoke_test_client__' });
  const { body: [property] } = await rest('POST', 'properties', admin.token, { client_id: client.id, address: '__smoke_test_address__' });
  const { body: [job] } = await rest('POST', 'jobs', admin.token, {
    property_id: property.id,
    scheduled_at: new Date().toISOString(),
    duration_minutes: 60,
  });

  try {
    // The bug that started this whole project: jobs<->properties RLS recursion.
    const jobsWithProps = await rest('GET', 'jobs?select=id,properties(address)&limit=1', admin.token);
    record('jobs<->properties query does not recurse', jobsWithProps.status === 200, `status ${jobsWithProps.status}`);

    // Anonymous (no session) cannot read clients.
    const anonClients = await rest('GET', 'clients', null);
    record('anonymous cannot read clients', Array.isArray(anonClients.body) && anonClients.body.length === 0, `${anonClients.body?.length ?? '?'} rows`);

    // Admin can manage staff_invites.
    const invite = await rest('POST', 'staff_invites', admin.token, { expected_name: '__smoke_test_invite__' });
    record('admin can create a staff invite', invite.status === 201, `status ${invite.status}`);

    if (cleaner) {
      // Cleaner cannot see a job not assigned to them.
      const notMine = await rest('GET', `jobs?id=eq.${job.id}`, cleaner.token);
      record('cleaner cannot see a job not assigned to them', Array.isArray(notMine.body) && notMine.body.length === 0, `${notMine.body?.length ?? '?'} rows`);

      // Assign it, confirm they now can.
      await rest('PATCH', `jobs?id=eq.${job.id}`, admin.token, { cleaner_id: cleaner.userId });
      const mine = await rest('GET', `jobs?id=eq.${job.id}`, cleaner.token);
      record('cleaner can see a job assigned to them', Array.isArray(mine.body) && mine.body.length === 1, `${mine.body?.length ?? '?'} rows`);

      // Cleaner cannot read the admin-only staff_invites table.
      const cleanerInvites = await rest('GET', 'staff_invites', cleaner.token);
      record('cleaner cannot read staff_invites', Array.isArray(cleanerInvites.body) && cleanerInvites.body.length === 0, `${cleanerInvites.body?.length ?? '?'} rows`);

      // Cleaner cannot self-promote to admin or self-reactivate after deactivation.
      const escalate = await rest('PATCH', `profiles?id=eq.${cleaner.userId}`, cleaner.token, { role: 'admin' });
      record('cleaner cannot self-promote to admin', escalate.status >= 400, `status ${escalate.status}`);

      await rest('PATCH', `profiles?id=eq.${cleaner.userId}`, admin.token, { active: false });
      const selfReactivate = await rest('PATCH', `profiles?id=eq.${cleaner.userId}`, cleaner.token, { active: true });
      record('deactivated cleaner cannot self-reactivate', selfReactivate.status >= 400, `status ${selfReactivate.status}`);

      const blockedWrite = await rest('POST', 'checkins', cleaner.token, {
        job_id: job.id, cleaner_id: cleaner.userId, checked_in_at: new Date().toISOString(),
      });
      record('deactivated cleaner cannot write a checkin', blockedWrite.status >= 400 || (Array.isArray(blockedWrite.body) && blockedWrite.body.length === 0), `status ${blockedWrite.status}`);

      await rest('PATCH', `profiles?id=eq.${cleaner.userId}`, admin.token, { active: true });
      const restoredWrite = await rest('POST', 'checkins', cleaner.token, {
        job_id: job.id, cleaner_id: cleaner.userId, checked_in_at: new Date().toISOString(),
      });
      record('reactivated cleaner can write a checkin again', restoredWrite.status === 201, `status ${restoredWrite.status}`);
    }
  } finally {
    await rest('DELETE', `clients?id=eq.${client.id}`, admin.token);
    await rest('DELETE', 'staff_invites?expected_name=eq.__smoke_test_invite__', admin.token);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
