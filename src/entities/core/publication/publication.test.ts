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
import { usePublicationsByHref } from './queries';

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
