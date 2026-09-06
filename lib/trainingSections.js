// The headings on the training index, in the order they appear on it.
//
// The database holds the key (a check constraint on training_videos.section,
// 0077) and this holds the wording, so a heading can be reworded without a
// migration and the two can never disagree about which headings exist.
export const TRAINING_SECTIONS = [
  { key: 'getting_started', label: 'Getting started' },
  { key: 'on_the_job', label: 'On the job' },
  { key: 'your_week', label: 'Your week' },
  { key: 'staying_in_touch', label: 'Staying in touch' },
];

export const TRAINING_SECTION_LABELS = Object.fromEntries(
  TRAINING_SECTIONS.map((s) => [s.key, s.label])
);

// "1:00", "0:58" - the form the design labels each video with. Seconds are
// always two digits, minutes never padded, so a sub-minute video reads
// "0:58" rather than ":58".
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
