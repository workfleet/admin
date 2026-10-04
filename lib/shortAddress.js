// A UK postcode on its own, as some addresses lead with one ("SA7 9AG,
// Llansamlet, ...") - the street, or failing that the area, is what
// anyone reading a card needs.
const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

// The street a card can fit, off an address that may carry the town,
// county and country after it. Some parts only make sense with the next
// one: "33, Gwendoline Street" puts the number on its own, and "Flat 2,
// 3 The Promenade" or "Unit 3, Kenfig Industrial Estate" the flat or unit,
// so those keep the part after them rather than leaving a card that just
// says "33" or "Unit 3". "unit 4 ash court" already says where it is.
export function shortAddress(address) {
  const parts = (address || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1 && POSTCODE.test(parts[0])) parts.shift();
  if (parts.length === 0) return '';
  if (parts.length > 1 && /^\d+[a-z]?$/i.test(parts[0])) return `${parts[0]} ${parts[1]}`;
  if (parts.length > 1 && /^(flat|unit|apartment|apt)\s+[\w-]+$/i.test(parts[0])) return `${parts[0]}, ${parts[1]}`;
  return parts[0];
}

const FILLER = new Set(['the', 'ltd', 'limited', 'uk', 'and', '&', '-']);
const wordsOf = (s) => (s || '').toLowerCase().split(/[^a-z0-9&]+/).filter((w) => w && !FILLER.has(w));

// Whether a client's name only repeats what the street already says:
// "Swansea Bus Station" under "Swansea City Bus Station", or "The Eagle"
// under "The Eagle Inn". Every word of the name appearing in the street is
// enough - saying it twice costs the line that names who else is on.
export function nameRepeatsStreet(name, street) {
  const nameWords = wordsOf(name);
  if (nameWords.length === 0) return false;
  const streetWords = new Set(wordsOf(street));
  return nameWords.every((w) => streetWords.has(w));
}
