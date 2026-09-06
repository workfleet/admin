// The office-only half of a staff profile (profile_private, 0088): the
// holiday adjustment and the deactivation date. Queried as an embed on
// profiles - `profile_private(holiday_adjustment_hours, deactivated_at)` -
// which the API returns as an object for a one-to-one join, but has
// returned as a one-element array in some versions. Read it through here
// so no page has to know which.

export function privateOf(row) {
  const p = row?.profile_private;
  if (Array.isArray(p)) return p[0] || null;
  return p || null;
}

// The profile row with the private fields lifted onto it, the shape every
// admin page used before the columns moved.
export function flattenPrivate(row) {
  if (!row) return row;
  const p = privateOf(row);
  const { profile_private, ...rest } = row;
  return {
    ...rest,
    holiday_adjustment_hours: p?.holiday_adjustment_hours ?? 0,
    deactivated_at: p?.deactivated_at ?? null,
  };
}
