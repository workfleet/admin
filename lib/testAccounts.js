// Staff logins that exist only so the office can try the cleaner app.
//
// The office keeps a "Test Cleaner" account to check what a cleaner sees
// after a change. It has to stay active - deactivating it would sign it
// straight out (0008) and block its writes (0009) - but it is not a member
// of staff and should not appear in the roster, the rota, the dashboard
// headcount, the chat directory, recipient pickers, reports or reminders.
//
// A code-side list rather than a column on profiles, so hiding an account
// needs no migration run by hand against the live project. Filtered after
// the query rather than in it, so a page never sends a filter the database
// might not understand.
export const TEST_ACCOUNT_IDS = [
  'f755f700-d28e-4e79-9e70-91f9d6540af7', // "Test Cleaner", created 2026-09-15
];

export function isTestAccount(id) {
  return TEST_ACCOUNT_IDS.includes(id);
}

// Rows with an `id` (or the given key) belonging to a test account are
// dropped. Tolerates null/undefined data the way `(rows || [])` did.
export function withoutTestAccounts(rows, key = 'id') {
  return (rows || []).filter((row) => !isTestAccount(row?.[key]));
}
