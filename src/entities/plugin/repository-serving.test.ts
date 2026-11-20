import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { remoteLookup } from 'src/entities/core/remote/client';
import { fileDistribution } from 'src/entities/file/distribution';
import { filePublication } from 'src/entities/file/publication';
import {
  distributionListHandler,
  inSetOf,
  listOf,
  pluginDistribution,
  pluginPublication,
  pluginRemote,
  pluginRepository,
  projectedBy,
  publicationListHandler,
} from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { server } from 'src/test-utils/server';
import { useRepositoryDistributions } from './distribution';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: createTestQueryClient() },
    children,
  );

describe('Unit: the remote lookup', { tags: ['unit'] }, () => {
  const serve = (rows: ReturnType<typeof pluginRemote>[]) => {
    const list = listOf('/pulp/api/v3/remotes/', rows, {
      pageSize: 1000,
      matching: (row, query) => {
        const hrefs = inSetOf(query, 'pulp_href__in');
        return hrefs === null || hrefs.includes(row.pulp_href);
      },
      projected: projectedBy,
    });
    server.use(list.handler);
    return list;
  };

  it('reads the remotes at the given addresses with one request, whatever their type', async () => {
    const file = pluginRemote('file', { name: 'a' });
    const git = {
      ...pluginRemote('file', { name: 'b' }),
    };
    git.pulp_href = git.pulp_href.replace(
      'remotes/file/file',
      'remotes/file/git',
    );
    const list = serve([file, git, pluginRemote('file', { name: 'c' })]);

    const found = await remoteLookup.byHrefs([file.pulp_href, git.pulp_href]);

    expect(found.map(({ name }) => name)).toEqual(['a', 'b']);
    expect(list.queries).toHaveLength(1);
    expect(list.queries[0]?.get('limit')).toBe('2');
  });

  it('sends nothing for no address', async () => {
    const list = serve([]);

    expect(await remoteLookup.byHrefs([])).toEqual([]);
    expect(list.queries).toHaveLength(0);
  });

  it('splits many addresses into groups that keep every request line under the budget', () => {
    const hrefs = Array.from(
      { length: 200 },
      () => pluginRemote('file').pulp_href,
    );

    const groups = remoteLookup.chunks(hrefs);

    expect(groups.length).toBeGreaterThan(1);
    expect(groups.flat()).toEqual(hrefs);
  });
});

describe('Unit: the publications of a repository', { tags: ['unit'] }, () => {
  it('reads every page and leaves out a publication of another repository', async () => {
    const repository = pluginRepository('file');
    const other = pluginRepository('file');
    const own = Array.from({ length: 1200 }, () =>
      pluginPublication('file', { repository: repository.pulp_href }),
    );
    const list = publicationListHandler('file', [
      ...own,
      pluginPublication('file', { repository: other.pulp_href }),
    ]);
    // a server that ignores the repository filter answers every publication
    server.use(
      listOf(
        list.path,
        [...own, pluginPublication('file', { repository: other.pulp_href })],
        {
          pageSize: 1000,
          projected: projectedBy,
        },
      ).handler,
    );

    const read = await filePublication.ofRepository(repository.pulp_href);

    expect(read).toHaveLength(1200);
    expect(
      read.every(({ repository_version: version }) =>
        version?.startsWith(repository.pulp_href),
      ),
    ).toBe(true);
  });
});

describe(
  'Unit: the distributions serving a repository',
  { tags: ['unit'] },
  () => {
    const serving = { entity: filePublication, servesFromPublication: true };

    it('marks a repository-bound distribution served only when the repository has a publication, with one read of its publications', async () => {
      const repository = pluginRepository('file');
      const publications = publicationListHandler('file', [
        pluginPublication('file', { repository: repository.pulp_href }),
      ]);
      server.use(
        distributionListHandler('file', [
          pluginDistribution('file', {
            name: 'bound',
            repository: repository.pulp_href,
          }),
        ]).handler,
        publications.handler,
      );

      const { result } = renderHook(
        () =>
          useRepositoryDistributions(
            fileDistribution,
            serving,
            repository.pulp_href,
          ),
        { wrapper },
      );

      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(result.current.distributions?.map(({ served }) => served)).toEqual(
        [true],
      );
      expect(publications.queries).toHaveLength(1);
      expect(publications.queries[0]?.get('repository')).toBe(
        repository.pulp_href,
      );
    });

    it('marks a version-bound distribution served only when that version has a publication', async () => {
      const repository = pluginRepository('file');
      const published = pluginPublication('file', {
        repository: repository.pulp_href,
        repository_version: `${repository.pulp_href}versions/2/`,
      });
      server.use(
        distributionListHandler('file', [
          pluginDistribution('file', {
            name: 'v2',
            repository_version: `${repository.pulp_href}versions/2/`,
          }),
          pluginDistribution('file', {
            name: 'v1',
            repository_version: `${repository.pulp_href}versions/1/`,
          }),
        ]).handler,
        publicationListHandler('file', [published]).handler,
      );

      const { result } = renderHook(
        () =>
          useRepositoryDistributions(
            fileDistribution,
            serving,
            repository.pulp_href,
          ),
        { wrapper },
      );

      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(
        Object.fromEntries(
          (result.current.distributions ?? []).map(({ row, served }) => [
            row.name,
            served,
          ]),
        ),
      ).toEqual({ v2: true, v1: false });
    });

    it('reads no publications of the repository when every distribution is bound to a publication or there is none', async () => {
      const repository = pluginRepository('file');
      const publications = publicationListHandler('file', []);
      server.use(
        distributionListHandler('file', []).handler,
        publications.handler,
      );

      const { result } = renderHook(
        () =>
          useRepositoryDistributions(
            fileDistribution,
            serving,
            repository.pulp_href,
          ),
        { wrapper },
      );

      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(result.current.distributions).toEqual([]);
      expect(publications.queries).toHaveLength(0);
    });
  },
);
