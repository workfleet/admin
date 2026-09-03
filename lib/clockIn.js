// Minutes of grace before a check-in counts as "late" - covers normal
// variance (parking, traffic) without flagging every few-minute margin.
export const LATE_GRACE_MINUTES = 5;

export function lateMinutes(checkedInAt, scheduledAt) {
  if (!checkedInAt || !scheduledAt) return null;
  const diffMinutes = (new Date(checkedInAt) - new Date(scheduledAt)) / 60000;
  return diffMinutes > LATE_GRACE_MINUTES ? Math.round(diffMinutes) : 0;
}

// How a shift came to be on the record, in the words you would use to
// somebody's face about it.
//
// There are now four ways an attendance row gets written and they are not the
// same statement. Somebody pressed a button at the door; the app worked out
// from their phone that they had gone; they told us afterwards they had
// worked and an admin agreed; or the office recorded it for them without
// being asked. 0072 set the rule when auto_checked_out was added - this is a
// record staff can be pulled up on, and the onboarding agreement has a clause
// about falsified clock-in records, so these must never look identical to
// whoever reads them back.
//
// The database has kept them apart since 0076 and 0078. The screens did not,
// which made the distinction worthless: a declared shift rendered exactly
// like a clocked one. This is the one place that decides, so the cleaner
// profile, the client page and the rota cannot drift into telling three
// different stories about the same shift.
export function describeClockRecord(checkin, claim) {
  if (!checkin) return null;

  if (checkin.self_declared) {
    if (claim?.raised_by_admin) return { label: 'Recorded by the office — not clocked', tone: 'declared' };
    if (claim) return { label: 'Declared by staff, approved — not clocked', tone: 'declared' };
    // No claim behind it. Attributing it to staff would be a guess, and the
    // wrong one for a time the office wrote in directly - which is how a
    // check-out gets corrected after the fact. Say only what is known.
    return { label: 'Recorded afterwards — not clocked', tone: 'declared' };
  }

  if (checkin.checked_out_at && checkin.auto_checked_out) {
    return { label: 'Checked out automatically — left the geofence', tone: 'inferred' };
  }

  return null; // An ordinary clock-in needs no explaining.
}

// Claims keyed so a checkin row can find its own. A cleaner can have more
// than one claim against a job over time - a declined one leaves the way
// clear for a corrected one - so the approved one wins; that is the one an
// attendance row was written from.
export function indexClaims(claims) {
  const byKey = new Map();
  for (const claim of claims || []) {
    const key = `${claim.job_id}:${claim.cleaner_id}`;
    if (claim.status === 'approved' || !byKey.has(key)) byKey.set(key, claim);
  }
  return byKey;
}

export function claimFor(index, checkin) {
  if (!index || !checkin) return null;
  return index.get(`${checkin.job_id}:${checkin.cleaner_id}`) || null;
}
