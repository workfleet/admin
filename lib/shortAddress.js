// The street a card can fit, off an address that may carry the town,
// county and country after it. "33, Gwendoline Street" and "Flat 2, 3 The
// Promenade" put the number in a part of its own, so that part keeps the
// next one with it rather than leaving a card that just says "33".
export function shortAddress(address) {
  const parts = (address || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length > 1 && /^\d+[a-z]?$/i.test(parts[0])) return `${parts[0]} ${parts[1]}`;
  if (parts.length > 1 && /^(flat|unit|apartment|apt)\b/i.test(parts[0])) return `${parts[0]}, ${parts[1]}`;
  return parts[0];
}
