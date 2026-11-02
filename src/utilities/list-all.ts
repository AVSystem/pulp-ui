const PAGE_SIZE = 500;

// Reads every page of a list endpoint. An error on any page rejects, so a
// partial list is never mistaken for a complete one. The page size must be one
// the server honours (Pulp allows up to 1000 rows per page).
export async function listAll<T>(
  list: (params) => Promise<{ data: { count: number; results: T[] } }>,
  params: Record<string, unknown>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const collected: T[] = [];

  for (let page = 1; ; page++) {
    const { data } = await list({ ...params, page, page_size: pageSize });
    collected.push(...data.results);

    if (data.results.length < pageSize || collected.length >= data.count) {
      return collected;
    }
  }
}
