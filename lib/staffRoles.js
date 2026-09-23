// Who the office can put on a job.
//
// For a long time that meant one role: 'cleaner'. It doesn't any more. The
// 'inventory' role (0101) was added for someone who only counts and reorders
// stock, and the stock take itself is now booked on the rota as a paid hour
// like any other visit - so that person has to be assignable, has to be able
// to clock in, and has to be paid for it.
//
// Anyone whose role is in this list is treated as bookable staff: they get a
// row on the rota, they can be picked when assigning a job, their hours reach
// payroll and accrue holiday, and the reminders about hours find them.
//
// What this is NOT:
//  - who can sign in to the office. That is admin/layout.js, and the
//    inventory role still sees only Inventory there.
//  - who can be offered someone else's shift. request_cover_for_job() (0070)
//    and rank_cover_candidates() (0084) still ask for a cleaner, on purpose:
//    cover for a cleaning shift should go to cleaners.
//  - is_staff() in the database (0021, 0035), which still means admin,
//    supervisor or cleaner. The inventory role is deliberately kept out of
//    the staff directory, Team Chat, company documents and training.
//
// The job policies themselves never asked about role - they go through
// is_active_cleaner() (0009), which only checks that the profile is active -
// so nothing in the database has to change for this to work.
export const BOOKABLE_ROLES = ['cleaner', 'inventory'];

export function isBookableRole(role) {
  return BOOKABLE_ROLES.includes(role);
}
