import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { URL_BUDGET } from 'src/entities/batch';
import {
  coreRepositoryListHandler,
  pluginRepository,
} from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { server } from 'src/test-utils/server';
import { RepositoryClient } from './client';
import { useRepositoriesByHref } from './queries';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: createTestQueryClient() },
    children,
  );

describe(
  'Unit: the repositories of every plugin read by address',
  { tags: ['unit'] },
  () => {
    it('reads the repositories at some addresses with one request, whatever their plugin', async () => {
      const file = pluginRepository('file', { name: 'a' });
      const rpm = pluginRepository('rpm', { name: 'b' });
      const left = pluginRepository('file', { name: 'c' });
      const list = coreRepositoryListHandler([file, rpm, left]);
      server.use(list.handler);

      const found = await RepositoryClient.byHrefs([
        file.pulp_href,
        rpm.pulp_href,
      ]);

      expect(found.map(({ name }) => name)).toEqual(['a', 'b']);
      expect(list.queries).toHaveLength(1);
      expect(list.queries[0]?.get('limit')).toBe('2');
      expect(list.queries[0]?.getAll('fields')).toEqual([
        'pulp_href',
        'name',
        'latest_version_href',
      ]);
    });

    it('drops a row of an address that was not asked for', async () => {
      const asked = pluginRepository('file', { name: 'a' });
      const other = pluginRepository('file', { name: 'b' });
      server.use(coreRepositoryListHandler([other]).handler);

      const found = await RepositoryClient.byHrefs([asked.pulp_href]);

      expect(found).toEqual([]);
    });

    it('sends nothing for no address', async () => {
      const list = coreRepositoryListHandler([]);
      server.use(list.handler);

      expect(await RepositoryClient.byHrefs([])).toEqual([]);
      expect(list.queries).toHaveLength(0);
    });

    it('cuts a long list of addresses into requests that stay under the URL budget', async () => {
      const rows = Array.from({ length: 300 }, () => pluginRepository('file'));
      const list = coreRepositoryListHandler(rows);
      server.use(list.handler);

      const hrefs = rows.map(({ pulp_href }) => pulp_href);
      const chunks = RepositoryClient.chunks(hrefs);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.flat()).toEqual(hrefs);
      for (const chunk of chunks) {
        await RepositoryClient.byHrefs(chunk);
      }
      for (const query of list.queries) {
        expect(`${list.path}?${query.toString()}`.length).toBeLessThanOrEqual(
          URL_BUDGET,
        );
      }
    });

    it('gives a screen the repositories by address, with one request for each group, and nothing for none', async () => {
      const rows = [
        pluginRepository('file', { name: 'a' }),
        pluginRepository('deb', { name: 'b' }),
      ];
      const list = coreRepositoryListHandler(rows);
      server.use(list.handler);

      const none = renderHook(() => useRepositoriesByHref([]), { wrapper });
      expect(none.result.current.status).toBe('success');
      expect(list.queries).toHaveLength(0);

      const some = renderHook(
        () => useRepositoriesByHref(rows.map(({ pulp_href }) => pulp_href)),
        { wrapper },
      );
      expect(some.result.current.repositories).toBeUndefined();
      await waitFor(() => expect(some.result.current.status).toBe('success'));

      expect(
        some.result.current.repositories?.get(rows[1]?.pulp_href as string)
          ?.name,
      ).toBe('b');
      expect(list.queries).toHaveLength(1);
    });
  },
);
