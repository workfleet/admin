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
