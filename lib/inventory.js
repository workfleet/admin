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
