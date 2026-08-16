// Returns the number of full years since `createdAt` if today is the
// anniversary of that date, otherwise null. Compares month+day only, not
// exact time, since `created_at` is a timestamp but the anniversary is a
// calendar-day concept.
export function getWorkAnniversaryYears(createdAt) {
  if (!createdAt) return null;
  const joined = new Date(createdAt);
  const today = new Date();
  const years = today.getFullYear() - joined.getFullYear();
  if (years < 1) return null;
  if (joined.getMonth() !== today.getMonth() || joined.getDate() !== today.getDate()) return null;
  return years;
}
