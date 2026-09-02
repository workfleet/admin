#!/usr/bin/env node
// End-to-end test for the missed clock-in path (migration 0076).
//
// Runs against a real Supabase project through the anon REST API with real
// logins, so every RLS policy and every definer function is exercised exactly
// as the app hits them. That matters more here than for most features: the
// rules that decide whether somebody gets paid live in the database, not in
// the React, and the SQL editor cannot test them - it runs as postgres, where
// auth.uid() is null and RLS is bypassed, so every policy in 0076 would be
// skipped and every is_admin_or_supervisor() check would come back false.
//
// Usage:
//   TEST_ADMIN_EMAIL=you@example.com TEST_ADMIN_PASSWORD=... \
//   TEST_CLEANER_EMAIL=cleaner@example.com TEST_CLEANER_PASSWORD=... \
//   node scripts/missed-clockin-e2e.js
//
// Both logins are required - the whole point is one role asking and the other
// deciding. Reads NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
// from .env.local. Creates and deletes its own throwaway fixture data, all of
// it prefixed __e2e_, and safe to run repeatedly against production.

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
// Access tokens are an alternative to passwords, for running this without
// anybody typing a credential into a terminal - a session minted from the
// service role (see scripts/mint-test-tokens.js) works exactly as a
// password login does here, because it is the same kind of token and RLS
// cannot tell the difference. That is the point: the test is only worth
// anything if the database treats it as the real user.
const ADMIN_TOKEN = process.env.TEST_ADMIN_TOKEN;
const CLEANER_TOKEN = process.env.TEST_CLEANER_TOKEN;
const ADMIN_ID = process.env.TEST_ADMIN_ID;
const CLEANER_ID = process.env.TEST_CLEANER_ID;

const haveTokens = ADMIN_TOKEN && CLEANER_TOKEN && ADMIN_ID && CLEANER_ID;
const havePasswords = ADMIN_EMAIL && ADMIN_PASSWORD && CLEANER_EMAIL && CLEANER_PASSWORD;

if (!haveTokens && !havePasswords) {
  console.error('Set TEST_ADMIN_EMAIL/PASSWORD and TEST_CLEANER_EMAIL/PASSWORD (existing logins) to run this,');
  console.error('or TEST_ADMIN_TOKEN/ID and TEST_CLEANER_TOKEN/ID from scripts/mint-test-tokens.js.');
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

function headers(token) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token || ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function rest(method, resource, token, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${resource}`, {
    method,
    headers: headers(token),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function rpc(name, token, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
const hoursAhead = (h) => new Date(Date.now() + h * 3600_000).toISOString();

async function jobStatus(id, token) {
  const { body } = await rest('GET', `jobs?id=eq.${id}&select=status`, token);
  return body?.[0]?.status;
}

async function main() {
  const admin = haveTokens ? { token: ADMIN_TOKEN, userId: ADMIN_ID } : await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const cleaner = haveTokens ? { token: CLEANER_TOKEN, userId: CLEANER_ID } : await login(CLEANER_EMAIL, CLEANER_PASSWORD);

  const { body: [client] } = await rest('POST', 'clients', admin.token, { name: '__e2e_missed_clockin__' });
  const { body: [property] } = await rest('POST', 'properties', admin.token, {
    client_id: client.id, address: '__e2e_missed_clockin_address__',
  });

  // Three fixtures, one per shape the rules have to tell apart.
  //   overdue  - ran yesterday, nobody clocked in, still says 'scheduled'
  //              because reconcile only runs when an admin opens a page
  //   future   - booked for later today, nothing to declare yet
  //   late     - already marked 'missed', to prove a real clock-in rescues it
  const mkJob = async (scheduled_at) => {
    const { body: [job] } = await rest('POST', 'jobs', admin.token, {
      property_id: property.id, scheduled_at, duration_minutes: 120,
    });
    await rest('POST', 'job_assignments', admin.token, { job_id: job.id, cleaner_id: cleaner.userId });
    return job;
  };

  const overdue = await mkJob(hoursAgo(26));
  const future = await mkJob(hoursAhead(3));
  const late = await mkJob(hoursAgo(26));
  await rest('PATCH', `jobs?id=eq.${late.id}`, admin.token, { status: 'missed' });

  // For the admin-confirms-it-directly path (0078): one overdue job nobody
  // has claimed, one with a pending claim to prove confirming absorbs it
  // rather than leaving it stuck, and one with nobody assigned at all.
  const unclaimed = await mkJob(hoursAgo(30));
  const alreadyAsked = await mkJob(hoursAgo(30));
  const { body: [orphan] } = await rest('POST', 'jobs', admin.token, {
    property_id: property.id, scheduled_at: hoursAgo(30), duration_minutes: 120,
  });

  try {
    // ---- What a cleaner may declare ----

    const futureClaim = await rest('POST', 'missed_clockin_claims', cleaner.token, {
      job_id: future.id, cleaner_id: cleaner.userId,
      worked_from: hoursAhead(3), worked_to: hoursAhead(5),
    });
    record('cleaner cannot declare a shift that has not happened yet',
      futureClaim.status >= 400, `status ${futureClaim.status}`);

    const forSomeoneElse = await rest('POST', 'missed_clockin_claims', cleaner.token, {
      job_id: overdue.id, cleaner_id: admin.userId,
      worked_from: hoursAgo(26), worked_to: hoursAgo(24),
    });
    record('cleaner cannot file a claim in somebody else\'s name',
      forSomeoneElse.status >= 400, `status ${forSomeoneElse.status}`);

    const claimRes = await rest('POST', 'missed_clockin_claims', cleaner.token, {
      job_id: overdue.id, cleaner_id: cleaner.userId,
      worked_from: hoursAgo(26), worked_to: hoursAgo(24),
      reason: '__e2e__ forgot to press check in',
    });
    record('cleaner can declare an overdue shift nobody clocked into',
      claimRes.status === 201, `status ${claimRes.status}`);
    const claim = claimRes.body?.[0];
    if (!claim) throw new Error('no claim row returned - nothing further can be tested');

    const duplicate = await rest('POST', 'missed_clockin_claims', cleaner.token, {
      job_id: overdue.id, cleaner_id: cleaner.userId,
      worked_from: hoursAgo(26), worked_to: hoursAgo(24),
    });
    record('a second pending claim on the same shift is refused',
      duplicate.status >= 400, `status ${duplicate.status}`);

    // ---- Who may decide ----
    // The one that matters. If a cleaner can approve their own claim then
    // this is not an approval workflow, it is a button that prints hours,
    // and the falsified-clock-in clause in the onboarding agreement is dead.

    const selfApprove = await rpc('decide_missed_clockin_claim', cleaner.token, {
      target_claim_id: claim.id, decision: 'approved', note: null,
    });
    record('cleaner cannot approve their own claim',
      selfApprove.body === 'not_allowed', `returned ${JSON.stringify(selfApprove.body)}`);
    record('the shift is still unpaid after a cleaner tries to self-approve',
      (await jobStatus(overdue.id, admin.token)) !== 'completed');

    const approve = await rpc('decide_missed_clockin_claim', admin.token, {
      target_claim_id: claim.id, decision: 'approved', note: '__e2e__ confirmed',
    });
    record('admin can approve the claim', approve.body === 'ok', `returned ${JSON.stringify(approve.body)}`);

    // ---- What approval actually did ----

    record('the shift now counts as completed',
      (await jobStatus(overdue.id, admin.token)) === 'completed');

    const { body: checkins } = await rest(
      'GET', `checkins?job_id=eq.${overdue.id}&select=self_declared,checked_in_at,checked_out_at`, admin.token);
    record('an attendance row was written for the shift', checkins?.length === 1, `${checkins?.length ?? '?'} rows`);
    record('and it is marked self-declared, not a clock-in that happened',
      checkins?.[0]?.self_declared === true, `self_declared=${checkins?.[0]?.self_declared}`);

    const reDecide = await rpc('decide_missed_clockin_claim', admin.token, {
      target_claim_id: claim.id, decision: 'declined', note: null,
    });
    record('a decided claim cannot be decided again',
      reDecide.body === 'already_decided', `returned ${JSON.stringify(reDecide.body)}`);

    const afterApproval = await rest('POST', 'missed_clockin_claims', cleaner.token, {
      job_id: overdue.id, cleaner_id: cleaner.userId,
      worked_from: hoursAgo(26), worked_to: hoursAgo(24),
    });
    record('a completed shift cannot be claimed again',
      afterApproval.status >= 400, `status ${afterApproval.status}`);

    // ---- 'missed' is no longer a one-way door ----
    // The second half of 0076: someone marked missed at their booked end who
    // then turns up and clocks in properly used to stay unpaid off a genuine
    // clock-in, because the trigger only ever promoted out of 'scheduled'.

    const lateCheckin = await rest('POST', 'checkins', cleaner.token, {
      job_id: late.id, cleaner_id: cleaner.userId, checked_in_at: new Date().toISOString(),
    });
    record('a late clock-in is accepted on a job already marked missed',
      lateCheckin.status === 201, `status ${lateCheckin.status}`);
    record('and it rescues the job out of missed',
      (await jobStatus(late.id, admin.token)) === 'in_progress',
      `status now ${await jobStatus(late.id, admin.token)}`);

    // ---- The office recording a shift nobody asked about (0078) ----

    const cleanerConfirm = await rpc('admin_confirm_missed_shift', cleaner.token, {
      target_job_id: unclaimed.id, note: null,
    });
    record('cleaner cannot record their own shift as worked',
      cleanerConfirm.body === 'not_allowed', `returned ${JSON.stringify(cleanerConfirm.body)}`);

    const confirmFuture = await rpc('admin_confirm_missed_shift', admin.token, {
      target_job_id: future.id, note: null,
    });
    record('admin cannot record a shift that has not happened yet',
      confirmFuture.body === 'not_missed', `returned ${JSON.stringify(confirmFuture.body)}`);

    const confirmOrphan = await rpc('admin_confirm_missed_shift', admin.token, {
      target_job_id: orphan.id, note: null,
    });
    record('a job with nobody assigned is refused rather than silently completed',
      confirmOrphan.body === 'no_assignees', `returned ${JSON.stringify(confirmOrphan.body)}`);

    const confirmed = await rpc('admin_confirm_missed_shift', admin.token, {
      target_job_id: unclaimed.id, note: '__e2e__ client confirmed',
    });
    record('admin can record an unclaimed shift as worked',
      confirmed.body === 'ok', `returned ${JSON.stringify(confirmed.body)}`);
    record('the recorded shift now counts as completed',
      (await jobStatus(unclaimed.id, admin.token)) === 'completed');

    const { body: adminClaims } = await rest(
      'GET', `missed_clockin_claims?job_id=eq.${unclaimed.id}&select=status,raised_by_admin`, admin.token);
    record('it leaves an approved record flagged as raised by the office',
      adminClaims?.length === 1 && adminClaims[0].status === 'approved' && adminClaims[0].raised_by_admin === true,
      JSON.stringify(adminClaims));

    const { body: adminCheckins } = await rest(
      'GET', `checkins?job_id=eq.${unclaimed.id}&select=self_declared`, admin.token);
    record('and an attendance row marked self-declared',
      adminCheckins?.length === 1 && adminCheckins[0].self_declared === true, JSON.stringify(adminCheckins));

    // A pending claim must be absorbed, not duplicated - otherwise the
    // cleaner's original sits in the queue for ever and 0076's unique index
    // would have rejected a second row anyway.
    await rest('POST', 'missed_clockin_claims', cleaner.token, {
      job_id: alreadyAsked.id, cleaner_id: cleaner.userId,
      worked_from: hoursAgo(30), worked_to: hoursAgo(28),
    });
    const absorbed = await rpc('admin_confirm_missed_shift', admin.token, {
      target_job_id: alreadyAsked.id, note: null,
    });
    record('recording a shift somebody had already claimed succeeds',
      absorbed.body === 'ok', `returned ${JSON.stringify(absorbed.body)}`);
    const { body: absorbedClaims } = await rest(
      'GET', `missed_clockin_claims?job_id=eq.${alreadyAsked.id}&select=status`, admin.token);
    record('and approves their claim rather than leaving it pending beside a duplicate',
      absorbedClaims?.length === 1 && absorbedClaims[0].status === 'approved', JSON.stringify(absorbedClaims));
  } finally {
    // Fixture teardown. jobs, assignments, checkins and claims all cascade
    // from the client, so this is enough - but it is in a finally so a failed
    // assertion above still leaves production clean.
    await rest('DELETE', `clients?id=eq.${client.id}`, admin.token);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('End-to-end test crashed:', err);
  process.exit(1);
});
