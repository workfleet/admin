// Turning the facts about a cover candidate into an order, and into words.
//
// rank_cover_candidates() (0084) says what is true of each cleaner for a
// given shift: worked this site before, how far away, hours already on that
// week, how their recent shifts went, whether they have already declined.
// This decides what those facts are worth. It is deliberately the only
// place that does, so the admin's list, the push that goes out, and the
// badge on a cleaner's own card all agree on who is a good fit and why.
//
// Every point awarded comes with a reason the office can read back. A rank
// nobody can explain is one nobody trusts, and this list decides who gets
// the first call at 6am.

// Beyond this the week is already heavy; a shift on top is the one that
// makes somebody miss the next one.
export const HEAVY_WEEK_HOURS = 45;
export const FULL_WEEK_HOURS = 38;

// A push that says "you're a good match" should mean it. Under this score
// the cleaner gets the ordinary offer.
export const GOOD_MATCH_SCORE = 35;

// null stays null: Number(null) is 0, and "0 km away" is a very different
// claim from "we don't know where they are".
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function shortDate(value) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Score one candidate. `job` is the shift being covered, for the hours it
// would add. Returns the score and the reasons in the order they were
// earned, biggest first.
export function scoreCandidate(candidate, { jobMinutes = 60 } = {}) {
  const reasons = [];
  let score = 0;

  const visits = num(candidate.visits_here) || 0;
  if (visits > 0) {
    // Knowing the site is the single thing that matters most: the key
    // safe, the alarm, which cupboard the mop lives in.
    const points = 30 + Math.min(visits, 5) * 4;
    score += points;
    reasons.push({
      key: 'visits',
      points,
      text: `Worked here ${visits === 1 ? 'once' : `${visits} times`}`
        + (candidate.last_visit_at ? ` (last ${shortDate(candidate.last_visit_at)})` : ''),
    });
  }

  const km = num(candidate.distance_km);
  if (km != null) {
    const basis = candidate.distance_basis === 'same_day_job' ? 'from their other job that day' : 'from their usual area';
    let points = 0;
    if (km <= 5) points = 25;
    else if (km <= 15) points = 15;
    else if (km <= 30) points = 5;
    if (points > 0) {
      score += points;
      reasons.push({ key: 'distance', points, text: `${km.toFixed(km < 10 ? 1 : 0)} km ${basis}` });
    } else {
      reasons.push({ key: 'distance', points: 0, text: `${Math.round(km)} km ${basis}` });
    }
  }

  const weekHours = num(candidate.hours_this_week) || 0;
  const afterHours = weekHours + jobMinutes / 60;
  if (afterHours > HEAVY_WEEK_HOURS) {
    score -= 20;
    reasons.push({ key: 'hours', points: -20, text: `Already ${weekHours.toFixed(1)}h that week` });
  } else if (afterHours <= FULL_WEEK_HOURS * 0.75) {
    score += 15;
    reasons.push({ key: 'hours', points: 15, text: `${weekHours.toFixed(1)}h that week - room for more` });
  } else {
    score += 5;
    reasons.push({ key: 'hours', points: 5, text: `${weekHours.toFixed(1)}h that week` });
  }

  const done = num(candidate.completed_recent) || 0;
  const missed = num(candidate.missed_recent) || 0;
  const total = done + missed;
  if (total >= 5) {
    const rate = done / total;
    const points = Math.round(rate * 20);
    score += points;
    reasons.push({ key: 'completion', points, text: `${Math.round(rate * 100)}% of recent shifts completed` });
  }

  const rated = num(candidate.rated_count) || 0;
  const avg = num(candidate.avg_rating);
  if (rated >= 3 && avg != null) {
    const points = Math.round((avg / 5) * 10);
    score += points;
    reasons.push({ key: 'rating', points, text: `Rated ${avg.toFixed(1)} by clients` });
  }

  if (candidate.declined) {
    reasons.push({ key: 'declined', points: 0, text: 'Already said no to this one' });
  }

  reasons.sort((a, b) => b.points - a.points);
  return { score, reasons };
}

// Order a list of candidates: eligible first, those who have not declined
// before those who have, then by score, then by name so the order is
// stable between loads.
export function rankCandidates(candidates, { jobMinutes = 60 } = {}) {
  return (candidates || [])
    .map((c) => ({ ...c, ...scoreCandidate(c, { jobMinutes }) }))
    .sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      if (!!a.declined !== !!b.declined) return a.declined ? 1 : -1;
      if (b.score !== a.score) return b.score - a.score;
      return String(a.full_name || '').localeCompare(String(b.full_name || ''));
    });
}

export function isGoodMatch(ranked) {
  return !!ranked && ranked.eligible && !ranked.declined && ranked.score >= GOOD_MATCH_SCORE;
}

// The one line that goes in a targeted push: the strongest reason only.
export function topReason(ranked) {
  const best = (ranked && ranked.reasons || []).find((r) => r.points > 0);
  return best ? best.text : null;
}
