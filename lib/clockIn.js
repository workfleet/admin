// Minutes of grace before a check-in counts as "late" - covers normal
// variance (parking, traffic) without flagging every few-minute margin.
export const LATE_GRACE_MINUTES = 5;

export function lateMinutes(checkedInAt, scheduledAt) {
  if (!checkedInAt || !scheduledAt) return null;
  const diffMinutes = (new Date(checkedInAt) - new Date(scheduledAt)) / 60000;
  return diffMinutes > LATE_GRACE_MINUTES ? Math.round(diffMinutes) : 0;
}
