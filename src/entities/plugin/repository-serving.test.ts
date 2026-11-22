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

    it('hands over the versions of the repository publications and its latest version, with one read of its publications', async () => {
      const repository = pluginRepository('file');
      const publications = publicationListHandler('file', [
        pluginPublication('file', {
          repository: repository.pulp_href,
          repository_version: `${repository.pulp_href}versions/1/`,
        }),
        pluginPublication('file', {
          repository: repository.pulp_href,
          repository_version: `${repository.pulp_href}versions/3/`,
        }),
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
            `${repository.pulp_href}versions/3/`,
          ),
        { wrapper },
      );

      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(result.current.distributions?.map(({ name }) => name)).toEqual([
        'bound',
      ]);
      expect(result.current.facts?.latestVersion).toBe(3);
      expect(result.current.facts?.publishedVersions.sort()).toEqual([1, 3]);
      expect(publications.queries).toHaveLength(1);
      expect(publications.queries[0]?.get('repository')).toBe(
        repository.pulp_href,
      );
    });

    it('hands over the version of the publication a distribution is bound to', async () => {
      const repository = pluginRepository('file');
      const published = pluginPublication('file', {
        repository: repository.pulp_href,
        repository_version: `${repository.pulp_href}versions/1/`,
      });
      server.use(
        distributionListHandler('file', [
          pluginDistribution('file', {
            name: 'pinned',
            publication: published.pulp_href,
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
            `${repository.pulp_href}versions/2/`,
          ),
        { wrapper },
      );

      await waitFor(() => expect(result.current.status).toBe('success'));
      expect(result.current.distributions?.map(({ name }) => name)).toEqual([
        'pinned',
      ]);
      expect(
        result.current.facts?.publicationVersions.get(published.pulp_href),
      ).toBe(1);
    });

    it('lists a version-bound distribution and reads the repository publications for it', async () => {
      const repository = pluginRepository('file');
      server.use(
        distributionListHandler('file', [
          pluginDistribution('file', {
            name: 'v2',
            repository_version: `${repository.pulp_href}versions/2/`,
          }),
          pluginDistribution('file', {
            name: 'foreign',
            repository_version: `${pluginRepository('file').pulp_href}versions/2/`,
          }),
        ]).handler,
        publicationListHandler('file', []).handler,
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
      expect(result.current.distributions?.map(({ name }) => name)).toEqual([
        'v2',
      ]);
      expect(result.current.facts?.latestVersion).toBeNull();
      expect(result.current.facts?.publishedVersions).toEqual([]);
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
