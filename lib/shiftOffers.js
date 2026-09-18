// Which cover offers a cleaner can see and act on.
//
// The ShiftCoverCard shows them, and the home page counts them in a pill
// under the greeting before the card has rendered. One rule here so the
// number on the pill is the number of rows on the card.

// Offers still worth showing: the job must have come back with the offer
// (a deleted shift has nothing to claim) and the offer must not have
// expired.
export function liveOffers(offerRows, now = new Date()) {
  return (offerRows || []).filter((o) => o?.jobs && (!o.expires_at || new Date(o.expires_at) > now));
}

// `mine` are the ones this cleaner released and can withdraw; `available`
// are everyone else's that this cleaner has not already said "not me" to
// (`declined` is the list of those offer ids).
export function splitOffers(live, declined, userId) {
  const declinedIds = new Set(declined || []);
  return {
    mine: (live || []).filter((o) => o.released_by === userId),
    available: (live || []).filter((o) => o.released_by !== userId && !declinedIds.has(o.id)),
  };
}
