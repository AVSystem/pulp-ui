import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  corePublicationListHandler,
  pluginPublication,
  pluginRepository,
} from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { server } from 'src/test-utils/server';
import { PublicationClient } from './client';
import { usePublicationsByHref, usePublicationsOfRepository } from './queries';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: createTestQueryClient() },
    children,
  );

describe(
  'Unit: the publications of every plugin read by address',
  { tags: ['unit'] },
  () => {
    it('reads the publications at some addresses with one request, whatever their plugin', async () => {
      const repository = pluginRepository('file');
      const file = pluginPublication('file', {
        repository: repository.pulp_href,
      });
      const rpm = pluginPublication('rpm');
      const left = pluginPublication('file');
      const list = corePublicationListHandler([file, rpm, left]);
      server.use(list.handler);

      const found = await PublicationClient.byHrefs([
        file.pulp_href,
        rpm.pulp_href,
      ]);

      expect(found.map(({ pulp_href }) => pulp_href)).toEqual([
        file.pulp_href,
        rpm.pulp_href,
      ]);
      expect(found[0]?.repository_version).toBe(file.repository_version);
      expect(list.queries).toHaveLength(1);
      expect(list.queries[0]?.get('limit')).toBe('2');
      expect(list.queries[0]?.getAll('fields')).toEqual([
        'pulp_href',
        'repository',
        'repository_version',
      ]);
    });

    it('sends nothing for no address', async () => {
      const list = corePublicationListHandler([]);
      server.use(list.handler);

      expect(await PublicationClient.byHrefs([])).toEqual([]);
      expect(list.queries).toHaveLength(0);
    });

    it('gives a screen the publications by address and the failure of a read', async () => {
      const row = pluginPublication('file');
      server.use(
        http.get('*/pulp/api/v3/publications/', () =>
          HttpResponse.json({ detail: 'Broken.' }, { status: 500 }),
        ),
      );

      const read = renderHook(() => usePublicationsByHref([row.pulp_href]), {
        wrapper,
      });

      await waitFor(() => expect(read.result.current.status).toBe('error'), {
        timeout: 10_000,
      });
      expect(read.result.current.publications).toBeUndefined();
    }, 20_000);
  },
);

describe(
  'Unit: the publications of one repository, a page at a time',
  { tags: ['unit'] },
  () => {
    const repository = pluginRepository('file');
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        pluginPublication('file', {
          repository: repository.pulp_href,
          repository_version: `${repository.pulp_href}versions/${index}/`,
          pulp_created: `2000-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
        }),
      );

    it('asks the server for one page of the repository, newest first, and says how many there are', async () => {
      const own = rows(5);
      const foreign = pluginPublication('rpm');
      const list = corePublicationListHandler([...own, foreign]);
      server.use(list.handler);

      const found = await PublicationClient.ofRepositoryPage(
        repository.pulp_href,
        { page: 2, page_size: 2, sort: '-pulp_created' },
      );

      expect(found.count).toBe(5);
      expect(found.results.map(({ pulp_href }) => pulp_href)).toEqual([
        own[2]?.pulp_href,
        own[1]?.pulp_href,
      ]);
      expect(list.queries).toHaveLength(1);
      const query = list.queries[0] as URLSearchParams;
      expect(query.get('repository')).toBe(repository.pulp_href);
      expect(query.get('offset')).toBe('2');
      expect(query.get('limit')).toBe('2');
      expect(query.getAll('ordering')).toEqual(['-pulp_created']);
    });

    it('gives a screen the page and reads it once for two screens that ask for it', async () => {
      const list = corePublicationListHandler(rows(3));
      server.use(list.handler);
      const client = createTestQueryClient();
      const shared = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client }, children);
      const params = { page: 1, page_size: 10, sort: '-pulp_created' };

      const first = renderHook(
        () => usePublicationsOfRepository(repository.pulp_href, params),
        { wrapper: shared },
      );
      const second = renderHook(
        () => usePublicationsOfRepository(repository.pulp_href, params),
        { wrapper: shared },
      );

      await waitFor(() => expect(first.result.current.data?.count).toBe(3));
      expect(second.result.current.data?.count).toBe(3);
      expect(list.queries).toHaveLength(1);
    });
  },
);
