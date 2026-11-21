import { getRepositoryVersionsListUrl } from '@pulp-ui/sdk/core/repository-versions';
import { describe, expect, it, vi } from 'vitest';
import { URL_BUDGET, chunkByUrl, runBounded } from './batch';

const UUID_TAIL = '-0000-4000-8000-';

// A version address of the length a real server answers with: the path of a
// file repository, a 36 character id and the version number.
function versionHref(index: number): string {
  const id = `${String(index).padStart(8, '0')}${UUID_TAIL}${String(index).padStart(12, '0')}`;
  return `/pulp/api/v3/repositories/file/file/${id}/versions/${index % 40}/`;
}

const urlOfVersions = (hrefs: string[]) =>
  getRepositoryVersionsListUrl({
    pulp_href__in: hrefs,
    limit: hrefs.length,
    fields: ['pulp_href', 'number', 'content_summary'],
  });

describe('Unit: chunkByUrl', { tags: ['unit'] }, () => {
  it('keeps the request line budget the server was measured against', () => {
    expect(URL_BUDGET).toBe(3500);
  });

  it('splits 500 real version addresses into requests that fit, in order, losing none', () => {
    const hrefs = Array.from({ length: 500 }, (_, index) => versionHref(index));

    const chunks = chunkByUrl(urlOfVersions, hrefs);

    expect(chunks.flat()).toEqual(hrefs);
    for (const chunk of chunks) {
      expect(chunk.length).toBeGreaterThan(0);
      expect(urlOfVersions(chunk).length).toBeLessThanOrEqual(3500);
    }
    // measured on the server: a chunk holds 28 to 29 addresses
    expect(chunks.length).toBeLessThanOrEqual(18);
    expect(chunks.length).toBeGreaterThanOrEqual(16);
  });

  it('fills each request as far as the budget allows', () => {
    const hrefs = Array.from({ length: 500 }, (_, index) => versionHref(index));

    const chunks = chunkByUrl(urlOfVersions, hrefs);

    // every chunk but the last would not have fitted one more address
    chunks.slice(0, -1).forEach((chunk, index) => {
      const next = chunks[index + 1][0];
      expect(urlOfVersions([...chunk, next]).length).toBeGreaterThan(3500);
    });
  });

  it('measures the URL the caller builds, not an estimate', () => {
    const lengths: number[] = [];
    const urlOf = (values: string[]) => {
      const url = `/x/?v=${values.join(',')}`;
      lengths.push(url.length);
      return url;
    };

    const chunks = chunkByUrl(urlOf, ['aaaa', 'bbbb', 'cccc', 'dddd'], 16);

    // "/x/?v=" is 6 characters, so two values of 4 and a comma make 15 and a
    // third would make 20
    expect(chunks).toEqual([
      ['aaaa', 'bbbb'],
      ['cccc', 'dddd'],
    ]);
    expect(Math.max(...lengths)).toBeGreaterThan(16);
  });

  it('sends a value that is longer than the budget alone', () => {
    const long = 'x'.repeat(50);
    const urlOf = (values: string[]) => `/x/?v=${values.join(',')}`;

    const chunks = chunkByUrl(urlOf, ['a', 'b', long, 'c', 'd'], 20);

    expect(chunks).toEqual([['a', 'b'], [long], ['c', 'd']]);
  });

  it('answers no request for no value', () => {
    expect(chunkByUrl(() => '/x/', [])).toEqual([]);
  });

  it('keeps one chunk when everything fits', () => {
    const urlOf = (values: string[]) => `/x/?v=${values.join(',')}`;

    expect(chunkByUrl(urlOf, ['a', 'b', 'c'])).toEqual([['a', 'b', 'c']]);
  });

  it('keeps a repeated value where it was given', () => {
    const urlOf = (values: string[]) => `/x/?v=${values.join(',')}`;

    expect(chunkByUrl(urlOf, ['a', 'a', 'b'], 9)).toEqual([['a', 'a'], ['b']]);
  });
});

describe('Unit: runBounded', { tags: ['unit'] }, () => {
  it('resolves with the results in the order of the items', async () => {
    const results = await runBounded([3, 1, 2], 2, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item));
      return item * 10;
    });

    expect(results).toEqual([30, 10, 20]);
  });

  it('never has more jobs in flight than the limit', async () => {
    let inFlight = 0;
    let most = 0;

    await runBounded(
      Array.from({ length: 20 }, (_, n) => n),
      4,
      async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
      },
    );

    expect(most).toBe(4);
  });

  it('runs every item once and resolves with nothing for no items', async () => {
    const seen: number[] = [];
    await runBounded([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });

    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(await runBounded([], 4, async () => 1)).toEqual([]);
  });

  it.each([0, -1, Number.NaN, 0.5])(
    'refuses the limit %s instead of running no job and resolving with holes',
    async (limit) => {
      const job = vi.fn(async (item: number) => item);

      await expect(runBounded([1, 2], limit, job)).rejects.toThrow(RangeError);
      expect(job).not.toHaveBeenCalled();
    },
  );

  it('rejects with the first error and starts no further item', async () => {
    const started: number[] = [];

    await expect(
      runBounded([1, 2, 3, 4, 5, 6, 7, 8], 2, async (item) => {
        started.push(item);
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (item === 2) {
          throw new Error('boom');
        }
      }),
    ).rejects.toThrow('boom');
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(started.length).toBeLessThan(8);
  });
});
