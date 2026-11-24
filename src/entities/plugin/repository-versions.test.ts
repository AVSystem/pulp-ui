import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { debRepository } from 'src/entities/deb/repository';
import { fileRepository } from 'src/entities/file/repository';
import { pythonRepository } from 'src/entities/python/repository';
import { rpmRepository } from 'src/entities/rpm/repository';
import {
  page,
  pluginRepository,
  repositoryVersion,
  versionListHandler,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { entityKeys } from './queries';

describe(
  'Unit: reading one version of a repository by its number',
  {
    tags: ['unit'],
  },
  () => {
    it('asks the versions list of the repository for exactly that number and one row', async () => {
      const repository = pluginRepository('file');
      const versions = [1, 2, 3].map((n) => repositoryVersion(repository, n));
      const list = versionListHandler(repository, versions);
      server.use(list.handler);

      const found = await fileRepository.versionByNumber(
        repository.pulp_href,
        2,
      );

      expect(found?.pulp_href).toBe(versions[1].pulp_href);
      expect(list.queries).toHaveLength(1);
      expect(list.queries[0].get('number')).toBe('2');
      expect(list.queries[0].get('limit')).toBe('1');
    });

    it('answers null for a number the repository has no version for', async () => {
      const repository = pluginRepository('file');
      server.use(
        versionListHandler(repository, [repositoryVersion(repository, 1)])
          .handler,
      );

      expect(
        await fileRepository.versionByNumber(repository.pulp_href, 7),
      ).toBe(null);
    });

    it('answers null when the server ignored the filter and returned another version', async () => {
      const repository = pluginRepository('file');
      server.use(
        http.get(`*${repository.pulp_href}versions/`, () =>
          HttpResponse.json(page([repositoryVersion(repository, 1)])),
        ),
      );

      expect(
        await fileRepository.versionByNumber(repository.pulp_href, 2),
      ).toBe(null);
    });

    it('sends no request for a number that is not a safe whole number', async () => {
      const repository = pluginRepository('file');
      const list = versionListHandler(repository, []);
      server.use(list.handler);

      for (const number of [-1, 1.5, Number.NaN, 1e20]) {
        expect(
          await fileRepository.versionByNumber(repository.pulp_href, number),
        ).toBe(null);
      }
      expect(list.queries).toHaveLength(0);
    });
  },
);

describe(
  'Unit: the keys of the versions of a repository',
  {
    tags: ['unit'],
  },
  () => {
    it('key the list by the repository address and the version by its number, under the plugin and the object', () => {
      const keys = entityKeys({ app: 'file', object: 'repository' });

      expect(keys.versions('/r/', { page: 2 })).toEqual([
        'pulp',
        'file',
        'repository',
        'versions',
        '/r/',
        { page: 2 },
      ]);
      expect(keys.version('/r/', 3)).toEqual([
        'pulp',
        'file',
        'repository',
        'version',
        '/r/',
        3,
      ]);
    });
  },
);

describe('Unit: deleting a version of a repository', { tags: ['unit'] }, () => {
  it.each([
    ['file', fileRepository, 'repositories/file/file'],
    ['deb', debRepository, 'repositories/deb/apt'],
    ['rpm', rpmRepository, 'repositories/rpm/rpm'],
    ['python', pythonRepository, 'repositories/python/python'],
  ] as const)(
    'sends one DELETE to the address of the %s version and resolves with the task',
    async (plugin, entity, segment) => {
      const requests: { method: string; path: string }[] = [];
      const version = `/pulp/api/v3/${segment}/0192/versions/3/`;
      server.use(
        http.delete(`*${version}`, ({ request }) => {
          requests.push({
            method: request.method,
            path: new URL(request.url).pathname,
          });
          return HttpResponse.json(
            { task: '/pulp/api/v3/tasks/0192/' },
            { status: 202 },
          );
        }),
      );

      expect(plugin).toBeTruthy();
      expect(await entity.deleteVersion(version)).toBe(
        '/pulp/api/v3/tasks/0192/',
      );
      expect(requests).toEqual([{ method: 'DELETE', path: version }]);
    },
  );
});
