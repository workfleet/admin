// A member of staff's bank details (staff_bank_details, 0099): where their
// pay goes. Shared between My Profile, where the person enters them, and
// the admin's view of a cleaner, where the office reads them for payroll,
// so both agree on what a valid sort code looks like and how much of an
// account number a screen should show.

export const BANK_DETAIL_FIELDS = [
  { key: 'account_holder_name', label: 'Name on the account', type: 'text', autoComplete: 'name', placeholder: 'As it appears on your bank card' },
  { key: 'sort_code', label: 'Sort code', type: 'text', inputMode: 'numeric', autoComplete: 'off', placeholder: 'e.g. 12-34-56' },
  { key: 'account_number', label: 'Account number', type: 'text', inputMode: 'numeric', autoComplete: 'off', placeholder: '8 digits' },
];

const KEYS = BANK_DETAIL_FIELDS.map((f) => f.key);

// Form state for a fresh entry. The saved row is never loaded back into
// the inputs: the person sees a masked summary of what is on file and
// types a full replacement if it needs to change, so a half-edited account
// number cannot be saved over a good one.
export function emptyBankForm() {
  const form = {};
  for (const key of KEYS) form[key] = '';
  return form;
}

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

// Form state to the row to save: spaces and dashes stripped from the
// numbers, name trimmed. Returns { row } when the entry is complete and
// well-formed, otherwise { error } with the thing to fix, in the words
// the person should see. The database checks the same shape (0099), so
// this is for the message, not the guarantee.
export function formToBankDetails(form) {
  const account_holder_name = String(form?.account_holder_name ?? '').trim();
  const sort_code = digitsOnly(form?.sort_code);
  const account_number = digitsOnly(form?.account_number);

  if (!account_holder_name) return { error: 'Enter the name on the account.' };
  if (sort_code.length !== 6) return { error: 'A sort code is 6 digits, e.g. 12-34-56.' };
  if (account_number.length !== 8) return { error: 'An account number is 8 digits.' };

  return { row: { account_holder_name, sort_code, account_number } };
}

// 123456 as 12-34-56, the way it is printed on a card or a statement.
export function formatSortCode(sortCode) {
  const digits = digitsOnly(sortCode);
  if (digits.length !== 6) return String(sortCode ?? '');
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
}

// Everything but the last four digits hidden, for the person's own screen:
// enough to recognise their account, not enough to be worth reading over
// a shoulder on the bus.
export function maskAccountNumber(accountNumber) {
  const digits = digitsOnly(accountNumber);
  if (!digits) return '';
  return `${'•'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
}
