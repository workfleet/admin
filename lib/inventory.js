// Whether a product should show up on the shopping list.
//
// The reorder threshold is the level you want to keep in stock, so a product
// sitting exactly on it (1 of 1) is fine and shouldn't be flagged — only once
// stock has actually dropped below that mark. A product that has run out is
// always flagged, even when its threshold is 0.
export function needsReorder(product) {
  const stock = Number(product?.stock_level) || 0;
  const threshold = Number(product?.reorder_threshold) || 0;
  return stock <= 0 || stock < threshold;
}

// The most recent change anywhere in the list - what the page header reports
// as "last updated". Returns the product carrying the newest updated_at, so
// the caller can say who made that change as well as when, or null when no
// row has a timestamp (an empty list, or one read before 0100 was applied).
export function latestUpdate(products) {
  let latest = null;
  for (const p of products || []) {
    if (!p?.updated_at) continue;
    if (!latest || new Date(p.updated_at) > new Date(latest.updated_at)) latest = p;
  }
  return latest;
}

// The line a printed shopping list carries under its date: "Stock last
// updated 17 Sep 2026, 16:02 by Jess Kidwell". A list is only as good as the
// count behind it, so the reader sees how fresh that count is and who to ask.
// Fixed to en-GB and UK time with the year spelt out, because the document is
// read on paper, away from the browser and the day that made it.
export function stockLastUpdatedLine(products) {
  const latest = latestUpdate(products);
  if (!latest) return null;
  const when = new Date(latest.updated_at).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
  });
  const who = latest.updater?.full_name;
  return `Stock last updated ${when}${who ? ` by ${who}` : ''}`;
}
