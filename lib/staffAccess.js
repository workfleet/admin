// Cutting off a staff member's sign-in, server side.
//
// A deactivated account is banned in Supabase Auth for a hundred years -
// in effect for good, but still reversible: reactivating sets the ban to
// 'none'. A ban refuses the next refresh of any session they already hold
// (so a phone that stayed signed in loses the app within the hour, and at
// once on its next page load, where the layouts check the flag) and refuses
// every new login. Their profile, history and payroll lines are untouched.
export const BANNED_FOR = '876000h';

// Returns the error, or null when it worked.
export async function setSignInBlocked(supabaseAdmin, userId, blocked) {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    ban_duration: blocked ? BANNED_FOR : 'none',
  });
  return error || null;
}
