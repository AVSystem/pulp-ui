import { describe, expect, it, vi } from 'vitest';
import { moveToPublication, pinnedToOlder } from './pinned-distributions';

const API = '/pulp/api/v3';
const REPOSITORY = `${API}/repositories/file/file/00000000-0000-4000-8000-000000000001/`;
const publication = (n: number) =>
  `${API}/publications/file/file/00000000-0000-4000-8000-00000000000${n}/`;

const row = (name: string, overrides = {}) => ({
  pulp_href: `${API}/distributions/file/file/${name}/`,
  name,
  base_path: name,
  ...overrides,
});

describe(
  'Unit: the distributions pinned to an older publication',
  { tags: ['unit'] },
  () => {
    const versions = new Map<string, number | null>([
      [publication(1), 1],
      [publication(2), 2],
      [publication(3), 3],
      [publication(9), null],
    ]);

    it('lists only distributions bound to a publication of an older version than the one published', () => {
      const rows = [
        row('old', { publication: publication(1) }),
        row('also-old', { publication: publication(2) }),
        row('same', { publication: publication(3) }),
        row('by-repository', { repository: REPOSITORY }),
        row('by-version', { repository_version: `${REPOSITORY}versions/1/` }),
        row('nothing'),
      ];

      expect(pinnedToOlder(rows, versions, 3).map(({ name }) => name)).toEqual([
        'old',
        'also-old',
      ]);
    });

    it('lists none when the version published is the oldest one pinned', () => {
      const rows = [row('old', { publication: publication(1) })];

      expect(pinnedToOlder(rows, versions, 1)).toEqual([]);
    });

    it('leaves out a publication that is not known or names no version', () => {
      const rows = [
        row('unknown', { publication: publication(8) }),
        row('no-number', { publication: publication(9) }),
      ];

      expect(pinnedToOlder(rows, versions, 5)).toEqual([]);
    });
  },
);

describe(
  'Unit: moving distributions to a publication',
  { tags: ['unit'] },
  () => {
    const failure = {
      response: { status: 400, statusText: '', data: { detail: 'No.' } },
    };

    it('sends the new binding and null for the other two to each distribution, and says what became of each', async () => {
      const update = vi.fn(async (href: string) => {
        if (href.endsWith('/bad/')) {
          throw failure;
        }
        return { kind: 'done' as const, object: {} };
      });
      const rows = [row('good'), row('bad'), row('fine')];

      const results = await moveToPublication(
        { app: 'file', update } as never,
        rows as never,
        publication(4),
        {},
      );

      expect(update.mock.calls.map(([href]) => href)).toEqual(
        rows.map(({ pulp_href }) => pulp_href),
      );
      for (const [, body] of update.mock.calls as unknown as [
        string,
        unknown,
      ][]) {
        expect(body).toEqual({
          publication: publication(4),
          repository: null,
          repository_version: null,
        });
      }
      expect(
        results.map(({ target, outcome }) => [target.name, outcome.kind]),
      ).toEqual([
        ['good', 'succeeded'],
        ['bad', 'failed'],
        ['fine', 'succeeded'],
      ]);
      expect(results[1]?.outcome).toMatchObject({
        kind: 'failed',
        reason: expect.stringContaining('No.'),
      });
    });

    it('sends nothing for no distribution', async () => {
      const update = vi.fn();

      expect(
        await moveToPublication(
          { app: 'file', update } as never,
          [],
          publication(4),
          {},
        ),
      ).toEqual([]);
      expect(update).not.toHaveBeenCalled();
    });
  },
);
