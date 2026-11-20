import { describe, expect, it } from 'vitest';
import { BULK_CONCURRENCY, runBounded } from './run-bounded';

describe('Unit: runBounded', { tags: ['unit'] }, () => {
  it('works at four at once', () => {
    expect(BULK_CONCURRENCY).toBe(4);
  });

  it('never has more jobs in flight than the limit and keeps the order of the items', async () => {
    let inFlight = 0;
    let most = 0;

    const results = await runBounded(
      Array.from({ length: 11 }, (_, index) => index),
      4,
      async (item) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        return item * 2;
      },
    );

    expect(most).toBe(4);
    expect(results).toStrictEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });

  it('sends nothing for no items', async () => {
    expect(await runBounded([], 4, async () => 1)).toStrictEqual([]);
  });

  it('tries every item, with a result for each, when some jobs report a failure as their result', async () => {
    const results = await runBounded(['a', 'b', 'c'], 2, async (item) =>
      item === 'b' ? { failed: item } : { done: item },
    );

    expect(results).toStrictEqual([
      { done: 'a' },
      { failed: 'b' },
      { done: 'c' },
    ]);
  });
});
