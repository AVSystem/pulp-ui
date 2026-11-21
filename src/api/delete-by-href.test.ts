import { describe, expect, it } from 'vitest';
import {
  hrefsOutsideCollection,
  recordApiRequests,
} from 'src/test-utils/api-requests';
import { plugin2api } from 'src/utilities/plugin-repository-base-path';

const ID = '00000000-0000-4000-8000-0000000000aa';

// The collection of each plugin's repositories and distributions.
const COLLECTIONS = {
  ansible: {
    repository: 'repositories/ansible/ansible/',
    distribution: 'distributions/ansible/ansible/',
  },
  deb: {
    repository: 'repositories/deb/apt/',
    distribution: 'distributions/deb/apt/',
  },
  file: {
    repository: 'repositories/file/file/',
    distribution: 'distributions/file/file/',
  },
  python: {
    repository: 'repositories/python/python/',
    distribution: 'distributions/python/pypi/',
  },
  rpm: {
    repository: 'repositories/rpm/rpm/',
    distribution: 'distributions/rpm/rpm/',
  },
};

const CASES = Object.entries(COLLECTIONS).flatMap(([plugin, collections]) =>
  (['repository', 'distribution'] as const).map((kind) => ({
    label: `${plugin} ${kind}`,
    plugin: plugin as keyof typeof COLLECTIONS,
    kind,
    collection: collections[kind],
  })),
);

function deleteOf(plugin: keyof typeof COLLECTIONS, kind: string) {
  const apis = plugin2api(plugin);
  const api = kind === 'repository' ? apis.RepositoryAPI : apis.DistributionAPI;

  return (href: string) => api.delete(href);
}

describe(
  'Integration: delete takes the address of the repository or distribution',
  { tags: ['integration'] },
  () => {
    it.each(CASES)(
      '$label: requests the path it requested for the id',
      async ({ plugin, kind, collection }) => {
        const sent = recordApiRequests();

        await deleteOf(plugin, kind)(`/pulp/api/v3/${collection}${ID}/`);

        expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([
          `DELETE /pulp/api/v3/${collection}${ID}/`,
        ]);
      },
    );

    describe.each(CASES)('$label', ({ plugin, kind, collection }) => {
      it.each(hrefsOutsideCollection(collection))(
        'refuses an address that is not one of its objects: %j',
        async (href) => {
          const sent = recordApiRequests();

          await expect(deleteOf(plugin, kind)(href)).rejects.toThrow(
            /does not name/,
          );

          expect(sent).toEqual([]);
        },
      );
    });
  },
);
