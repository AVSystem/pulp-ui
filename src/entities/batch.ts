// The longest request URL a read that lists many values (an `__in` filter) is
// allowed to have. The server refuses a request line over 4,094 bytes; the
// budget stays well under that, so the method, the protocol and the longer
// base path of another deployment still fit.
export const URL_BUDGET = 3500;

// Splits values into groups for a read that sends them in the address, so
// that no request URL is longer than the budget. `urlOf` builds the URL a
// request for one group would have, with the same builder the request is made
// with, so the length is measured on the string that is sent (every value
// grows by what the encoding adds, which an estimate would miss).
//
// The groups keep the order of the values and together hold every value once
// for each time it was given. A value that does not fit a request even alone
// is sent alone: the read then fails visibly instead of the value being lost.
export function chunkByUrl<T>(
  urlOf: (values: T[]) => string,
  values: readonly T[],
  budget: number = URL_BUDGET,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];

  for (const value of values) {
    if (current.length === 0) {
      current = [value];
    } else if (urlOf([...current, value]).length <= budget) {
      current.push(value);
    } else {
      chunks.push(current);
      current = [value];
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

// Runs the jobs with at most `limit` in flight at once and resolves with their
// results in the order of the items. A job that rejects stops the others from
// starting another item and rejects the whole run with its error, so a failed
// batch does not go on sending requests nobody waits for.
export async function runBounded<T, R>(
  items: readonly T[],
  limit: number,
  job: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;

  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await job(items[index] as T);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
