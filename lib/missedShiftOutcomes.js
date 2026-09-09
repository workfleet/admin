// What the office can record against a shift nobody clocked into
// (missed_shift_outcomes, 0093), and what each one means for the person.
//
// None of these pay. The paid route is "they worked it" (0078), which is a
// separate, deliberate decision. These exist so that a period cannot close
// with a missed shift nobody has looked at, and so that a client's
// cancellation and a no-show stop looking identical on the cleaner's record.

export const MISSED_SHIFT_OUTCOMES = [
  {
    key: 'client_cancelled',
    label: 'Client cancelled',
    hint: 'The visit was called off. Applies to everyone on the job.',
    // The cancellation is about the job, so recording it for one person
    // records it for all of them.
    jobWide: true,
    againstCleaner: false,
  },
  { key: 'sick', label: 'Off sick', againstCleaner: false },
  { key: 'authorised_absence', label: 'Authorised absence', againstCleaner: false },
  {
    key: 'turned_away',
    label: 'Turned away on site',
    hint: 'They arrived but could not work. Unpaid here - use "they worked it" if you decide to pay it.',
    againstCleaner: false,
  },
  { key: 'no_show', label: 'Did not turn up', againstCleaner: true },
];

const BY_KEY = Object.fromEntries(MISSED_SHIFT_OUTCOMES.map((o) => [o.key, o]));

export function outcomeLabel(key) {
  return BY_KEY[key]?.label || 'Recorded';
}

export function isJobWideOutcome(key) {
  return Boolean(BY_KEY[key]?.jobWide);
}

// Whether a missed shift with this outcome should count against the
// person's completion rate. A shift with no outcome recorded still does,
// as it always has - the point of the outcome is to lift that where it is
// not their doing. An outcome this code does not know is treated the
// conservative way, as if nothing were recorded.
export function countsAgainstCleaner(key) {
  if (!key) return true;
  const outcome = BY_KEY[key];
  return outcome ? outcome.againstCleaner : true;
}
