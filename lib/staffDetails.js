// The personal details held about a member of staff (staff_details, 0092):
// what the office needs to reach them, pay them, and act for them in an
// emergency. Shared between the admin's view of a cleaner and the cleaner's
// own My Profile page so both edit the same set of fields with the same
// labels, and neither has to know how a blank turns into a null.

export const STAFF_DETAIL_FIELDS = [
  { key: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  { key: 'address', label: 'Home address', type: 'text', autoComplete: 'street-address' },
  { key: 'date_of_birth', label: 'Date of birth', type: 'date' },
  { key: 'ni_number', label: 'National Insurance number', type: 'text', placeholder: 'e.g. QQ 12 34 56 C' },
  { key: 'emergency_contact_name', label: 'Emergency contact name', type: 'text' },
  { key: 'emergency_contact_phone', label: 'Emergency contact phone', type: 'tel' },
  // Set by the office, shown to the person - the day they actually started,
  // which is not always the day their account was made.
  { key: 'start_date', label: 'Start date', type: 'date', officeOnly: true },
];

const KEYS = STAFF_DETAIL_FIELDS.map((f) => f.key);

// A staff_details row (or nothing) as form state: every field a string, so
// inputs stay controlled from the first render.
export function detailsToForm(row) {
  const form = {};
  for (const key of KEYS) form[key] = row?.[key] == null ? '' : String(row[key]);
  return form;
}

// Form state back to a row to save: trimmed, blanks stored as null rather
// than empty strings, and the NI number in the standard upper-case,
// no-spaces shape so two people typing it differently produce the same
// value. Only the keys asked for are returned, so a page that does not show
// the office-only fields cannot blank them by omission.
export function formToDetails(form, keys = KEYS) {
  const row = {};
  for (const key of keys) {
    let value = form?.[key];
    value = value == null ? '' : String(value).trim();
    if (key === 'ni_number') value = value.replace(/\s+/g, '').toUpperCase();
    row[key] = value === '' ? null : value;
  }
  return row;
}

// Which of the details the office cannot do without are still blank - the
// things you need on the day something goes wrong, not the whole form.
export function missingEssentials(row) {
  const missing = [];
  if (!row?.phone) missing.push('phone');
  if (!row?.address) missing.push('address');
  if (!row?.emergency_contact_name && !row?.emergency_contact_phone) missing.push('emergency contact');
  return missing;
}

// A date column comes back as 'YYYY-MM-DD'. Parsing that with new Date()
// treats it as UTC midnight, which in a zone behind UTC displays as the day
// before; pinning it to local midnight avoids that.
export function formatDateOnly(value) {
  if (!value) return '';
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d) ? String(value) : d.toLocaleDateString();
}
