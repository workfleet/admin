// A soft colour per person, so rows are told apart at a glance.
const AVATAR_TINTS = [
  ['#E8EEFB', '#1A56B8'], // blue
  ['#FDECE7', '#B2412F'], // coral
  ['#E6F4EC', '#1B7A4B'], // green
  ['#F1EAFB', '#6B3FB0'], // purple
  ['#FBF1DF', '#8A5A0B'], // amber
  ['#E3F3F3', '#0F6E70'], // teal
  ['#FBE9F2', '#A23668'], // pink
  ['#ECEEF1', '#3B4249'], // grey
];

// Colours handed out in order down the team list (sorted by name), so
// neighbours never share one - picking from a hash of the id put three
// people in a row on the same green. The rota and the dashboard both build
// this from the same list in the same order, so a person is the same
// colour on both.
export function tintsByOrder(ids) {
  const map = new Map();
  ids.forEach((id, i) => map.set(id, AVATAR_TINTS[i % AVATAR_TINTS.length]));
  return map;
}

// For someone not on the current list (a former member of staff still
// holding a job), a colour from their id.
export function tintFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
