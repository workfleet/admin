// A colour for each client on the rota, so one client's visits can be
// picked out across the week at a glance instead of every job being the
// same grey.
//
// The palette stays clear of red (missed, needs a cleaner) and green (done,
// on site): on the rota those are states, and a client's colour must never
// read as one. Ten hues for some thirty clients means a few share a colour;
// it is a scanning aid, and the name is always on the chip.
//
// Keyed on the client's id so the colour is the same on every day, every
// week and every screen, and doesn't shift when a client is added.
export const CLIENT_PALETTE = [
  '#2F6FDF', // blue
  '#0E8A8A', // teal
  '#7357D6', // violet
  '#C27C0E', // amber
  '#C2418D', // magenta
  '#3E55C9', // indigo
  '#0B86AE', // cyan
  '#9A5B2E', // brown
  '#5B6B8C', // slate
  '#A35FC4', // orchid
];

// djb2 - small, stable across browsers and sessions, spreads uuids well.
function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h;
}

export function clientColour(key) {
  if (!key) return null;
  return CLIENT_PALETTE[hash(String(key)) % CLIENT_PALETTE.length];
}
