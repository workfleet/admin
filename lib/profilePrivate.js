// The office-only half of a staff profile (profile_private, 0088): the
// holiday adjustment, the deactivation date and, since 0104, whether the
// person is an employee or a subcontractor. Queried as an embed on
// profiles - `profile_private(holiday_adjustment_hours, deactivated_at)` -
// which the API returns as an object for a one-to-one join, but has
// returned as a one-element array in some versions. Read it through here
// so no page has to know which.
import { supabase } from './supabaseClient';

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
    employment_type: p?.employment_type || 'employee',
  };
}

// A subcontractor invoices for their hours and accrues no holiday, so the
// pages that show or take holiday leave it out for them. Anything but the
// explicit value - a missing row, a database without 0104 yet - is an
// employee, which is what every account was before the column existed.
export function isSubcontractor(employmentType) {
  return employmentType === 'subcontractor';
}

// Employment type per profile id. Asked for on its own rather than added to
// the profiles embed the admin pages use, because a database that has not
// had 0104 run yet refuses the whole embed and blanks the page (the
// Inventory page went down exactly this way, c0cb969); on its own, a
// missing column just means everyone reads as an employee until the
// migration is run. A cleaner is only shown their own row, which is all
// their pages need.
export async function fetchEmploymentTypes() {
  const { data, error } = await supabase.from('profile_private').select('profile_id, employment_type');
  if (error || !data) return {};
  const byId = {};
  data.forEach((row) => { byId[row.profile_id] = row.employment_type || 'employee'; });
  return byId;
}
