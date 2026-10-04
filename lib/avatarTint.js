// A soft colour per person, so rows are told apart at a glance. Picked from
// the id rather than the position, so nobody changes colour when someone
// joins or leaves the list - and the rota and the dashboard agree on it.
const AVATAR_TINTS = [
  ['#E8EEFB', '#1A56B8'],
  ['#FDECE7', '#B2412F'],
  ['#E6F4EC', '#1B7A4B'],
  ['#F1EAFB', '#6B3FB0'],
  ['#FBF1DF', '#8A5A0B'],
  ['#E3F3F3', '#0F6E70'],
  ['#FBE9F2', '#A23668'],
  ['#ECEEF1', '#3B4249'],
];

export function tintFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
