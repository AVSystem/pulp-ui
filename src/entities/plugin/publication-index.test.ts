import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { filePublication } from 'src/entities/file/publication';
import {
  pluginPublication,
  pluginRepository,
  publicationListHandler,
} from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { server } from 'src/test-utils/server';
import {
  PUBLICATION_INDEX_FIELDS,
  PUBLICATION_INDEX_PAGES,
  usePublicationIndex,
} from './publication';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: createTestQueryClient() },
    children,
  );

// `count` publications of one repository, one per version number from 1.
function publicationsOf(repository: string, count: number, from = 1) {
  return Array.from({ length: count }, (_, n) =>
    pluginPublication('file', {
      repository,
      repository_version: `${repository}versions/${from + n}/`,
    }),
  );
}

describe('Unit: the publication index of a plugin', { tags: ['unit'] }, () => {
  it('reads pages of 1,000 and stops at the tenth page', () => {
    expect(PUBLICATION_INDEX_PAGES).toBe(10);
    expect([...PUBLICATION_INDEX_FIELDS]).toEqual([
      'pulp_href',
      'repository',
      'repository_version',
      'pulp_created',
    ]);
  });

  it('reads an index of 12,000 publications with exactly 10 requests and says it is over the bound', async () => {
    const repository = pluginRepository('file');
    const list = publicationListHandler(
      'file',
      publicationsOf(repository.pulp_href, 12_000),
    );
    server.use(list.handler);

    const index = await filePublication.index();

    expect(list.queries).toHaveLength(10);
    expect(list.queries.map((query) => query.get('offset'))).toEqual(
      Array.from({ length: 10 }, (_, n) => String(n * 1000)),
    );
    for (const query of list.queries) {
      expect(query.get('limit')).toBe('1000');
      expect(query.getAll('fields')).toEqual([...PUBLICATION_INDEX_FIELDS]);
    }
    expect(index.overBound).toBe(true);
  });

  it('reads an index of exactly 10,000 publications in 10 requests and says it is within the bound', async () => {
    const repository = pluginRepository('file');
    const list = publicationListHandler(
      'file',
      publicationsOf(repository.pulp_href, 10_000),
    );
    server.use(list.handler);

    const index = await filePublication.index();

    expect(list.queries).toHaveLength(10);
    expect(index.overBound).toBe(false);
  });

  it('reads 1,003 publications with two requests', async () => {
    const repository = pluginRepository('file');
    const list = publicationListHandler(
      'file',
      publicationsOf(repository.pulp_href, 1003),
    );
    server.use(list.handler);

    const index = await filePublication.index();

    expect(list.queries).toHaveLength(2);
    expect(index.overBound).toBe(false);
  });

  it('names the newest published version of a repository whatever the order the publications were made in', async () => {
    const repository = pluginRepository('file');
    const other = pluginRepository('file');
    const rows = [
      ...publicationsOf(repository.pulp_href, 1, 3),
      ...publicationsOf(repository.pulp_href, 1, 1),
      ...publicationsOf(other.pulp_href, 1, 2),
    ];
    server.use(publicationListHandler('file', rows).handler);

    const index = await filePublication.index();

    expect(index.newestPublishedVersion(repository.pulp_href)).toBe(3);
    expect(index.newestPublishedVersion(other.pulp_href)).toBe(2);
    expect(
      index.newestPublishedVersion(pluginRepository('file').pulp_href),
    ).toBeNull();
  });

  it('tells which versions have a publication', async () => {
    const repository = pluginRepository('file');
    server.use(
      publicationListHandler('file', publicationsOf(repository.pulp_href, 1, 2))
        .handler,
    );

    const index = await filePublication.index();

    expect(
      index.versionHasPublication(`${repository.pulp_href}versions/2/`),
    ).toBe(true);
    expect(
      index.versionHasPublication(`${repository.pulp_href}versions/1/`),
    ).toBe(false);
    expect(index.versionHasPublication(null)).toBe(false);
  });

  it('sends nothing until it is asked for, and then reads once for every subscriber', async () => {
    const repository = pluginRepository('file');
    const list = publicationListHandler(
      'file',
      publicationsOf(repository.pulp_href, 3),
    );
    server.use(list.handler);

    const idle = renderHook(
      () => usePublicationIndex(filePublication, { enabled: false }),
      { wrapper },
    );
    expect(idle.result.current.status).toBe('idle');
    expect(list.queries).toHaveLength(0);

    const reading = renderHook(
      () => usePublicationIndex(filePublication, { enabled: true }),
      { wrapper },
    );
    await waitFor(() => expect(reading.result.current.status).toBe('ready'));

    expect(list.queries).toHaveLength(1);
    expect(
      reading.result.current.index?.newestPublishedVersion(
        repository.pulp_href,
      ),
    ).toBe(3);
  });
});
