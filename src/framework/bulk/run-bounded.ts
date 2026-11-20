// How many requests of one bulk or multi-object action are in flight at once.
export const BULK_CONCURRENCY = 4;

// Runs the jobs with at most `limit` in flight at once and resolves with their
// results in the order of the items. A job must not reject: it resolves with
// its own failure, so one object that cannot be handled never stops the
// others from being tried, and the caller can report every object.
export async function runBounded<T, R>(
  items: readonly T[],
  limit: number,
  job: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await job(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
