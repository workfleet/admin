// Every row a query matches, not just the first thousand.
//
// PostgREST returns at most 1000 rows per request and gives no error when
// it stops - a page summing a longer history silently sums part of it. Use
// this where the whole set genuinely matters (payroll lines, exports, an
// "all time" report); anything shown as a list should be bounded by a date
// window instead, and a total should be added up in the database.
//
// `makeQuery` builds a fresh query each call, because a Supabase query
// builder can only be awaited once. It must set a stable order (end with
// .order('id') if nothing else is unique), or rows can repeat or go missing
// between pages:
//
//   const { data, error } = await fetchAllRows(() =>
//     supabase.from('payroll_period_lines').select('...').order('id'));
//
// Resolves to { data, error } like a single query. On an error part-way
// through, data is null, so a caller never mistakes a partial set for the
// whole one.
export const PAGE_SIZE = 1000;

export async function fetchAllRows(makeQuery, pageSize = PAGE_SIZE) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return { data: rows, error: null };
  }
}
