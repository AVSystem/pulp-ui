import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError } from 'src/entities/response-shape';
import { reportUnauthorized, setSignedIn } from 'src/session/session-events';
import {
  pluginRepository,
  repositoryVersion,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { server } from 'src/test-utils/server';
import { RepositoryVersionClient } from './client';
import { contentCount } from './model';
import { useVersionSummaries, versionSummaryKeys } from './queries';

const VERSIONS = '/pulp/api/v3/repository_versions/';

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

// The latest version of a repository that holds `count` files, as the server
// returns it.
function versionOf(count: number) {
  const repository = pluginRepository('file');
  return repositoryVersion(repository, 3, {
    content_summary: {
      added: {},
      removed: {},
      present: {
        'file.file': { count, href: `${repository.pulp_href}content/` },
      },
    },
  });
}

function versions(length: number) {
  return Array.from({ length }, (_, index) => versionOf(index + 1));
}

// The length of the request a recorded query belongs to, path included.
function urlLength(query: URLSearchParams): number {
  return `${VERSIONS}?${query.toString()}`.length;
}

const SOME_VERSION = '/pulp/api/v3/repositories/file/file/a/versions/1/';

describe('Unit: contentCount', { tags: ['unit'] }, () => {
  it('adds up the content that is present, over every content type', () => {
    expect(
      contentCount({
        pulp_href: SOME_VERSION,
        content_summary: {
          added: { 'file.file': { count: 100 } },
          removed: {},
          present: {
            'file.file': { count: 3, href: '/x/' },
            'rpm.package': { count: 4 },
          },
        },
      }),
    ).toBe(7);
  });

  it('is zero for a version that holds nothing and none for no summary', () => {
    expect(
      contentCount({
        pulp_href: SOME_VERSION,
        content_summary: { added: {}, removed: {}, present: {} },
      }),
    ).toBe(0);
    expect(contentCount({ pulp_href: SOME_VERSION })).toBeNull();
    expect(
      contentCount({
        pulp_href: SOME_VERSION,
        content_summary: { present: { 'file.file': {} } },
      }),
    ).toBe(0);
  });
});

describe('Unit: RepositoryVersionClient', { tags: ['unit'] }, () => {
  it('reads 500 latest versions in at most 18 requests, each under the budget', async () => {
    const rows = versions(500);
    const list = versionSummaryHandler({ patched: true, versions: rows });
    server.use(list.handler);
    const hrefs = rows.map((row) => row.pulp_href);

    const chunks = RepositoryVersionClient.chunks(hrefs);
    const read = (
      await Promise.all(
        chunks.map((chunk) => RepositoryVersionClient.summaries(chunk)),
      )
    ).flat();

    expect(chunks.length).toBeLessThanOrEqual(18);
    expect(chunks.flat()).toEqual(hrefs);
    expect(list.queries).toHaveLength(chunks.length);
    for (const query of list.queries) {
      expect(urlLength(query)).toBeLessThanOrEqual(3500);
      expect(query.getAll('fields')).toEqual(['pulp_href', 'content_summary']);
    }
    expect(read.map((row) => row.pulp_href).sort()).toEqual([...hrefs].sort());
  });

  it('sends nothing for no address and keeps an address once', async () => {
    const rows = versions(2);
    const list = versionSummaryHandler({ patched: true, versions: rows });
    server.use(list.handler);

    expect(await RepositoryVersionClient.summaries([])).toEqual([]);
    expect(RepositoryVersionClient.chunks([])).toEqual([]);
    expect(
      RepositoryVersionClient.chunks([
        rows[0].pulp_href,
        rows[0].pulp_href,
        rows[1].pulp_href,
      ]).flat(),
    ).toEqual(rows.map((row) => row.pulp_href));
    expect(list.queries).toHaveLength(0);
  });

  it('drops a row it did not ask for, as a server that ignored the filter would answer', async () => {
    const rows = versions(3);
    server.use(
      http.get(`*${VERSIONS}`, () =>
        HttpResponse.json({
          count: 3,
          next: null,
          previous: null,
          results: rows,
        }),
      ),
    );

    const read = await RepositoryVersionClient.summaries([rows[1].pulp_href]);

    expect(read.map((row) => row.pulp_href)).toEqual([rows[1].pulp_href]);
  });

  it('refuses an answer whose address is not a path of this server', async () => {
    const row = versionOf(1);
    server.use(
      http.get(`*${VERSIONS}`, () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [{ ...row, pulp_href: 'https://elsewhere.example/v/1/' }],
        }),
      ),
    );

    await expect(
      RepositoryVersionClient.summaries([row.pulp_href]),
    ).rejects.toBeInstanceOf(ResponseShapeError);
  });
});

describe('Unit: useVersionSummaries', { tags: ['unit'] }, () => {
  it('reads 500 hrefs in as many requests as chunks and each summary once', async () => {
    const rows = versions(500);
    const list = versionSummaryHandler({ patched: true, versions: rows });
    server.use(list.handler);
    const hrefs = rows.map((row) => row.pulp_href);
    const client = createTestQueryClient();

    const { result } = renderHook(() => useVersionSummaries(hrefs), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    const requests = RepositoryVersionClient.chunks(hrefs).length;
    expect(requests).toBeLessThanOrEqual(18);
    expect(list.queries).toHaveLength(requests);
    expect(result.current.counts.size).toBe(500);
    expect(result.current.counts.get(rows[41].pulp_href)).toBe(42);

    // the same hrefs again, in a second subscriber: nothing is read
    const again = renderHook(() => useVersionSummaries(hrefs), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(again.result.current.state).toBe('ready'));
    expect(list.queries).toHaveLength(requests);
  });

  it('reads only the summaries a changed list does not hold yet', async () => {
    const rows = versions(60);
    const list = versionSummaryHandler({ patched: true, versions: rows });
    server.use(list.handler);
    const client = createTestQueryClient();
    const first = rows.slice(0, 20).map((row) => row.pulp_href);
    const second = rows.slice(10, 30).map((row) => row.pulp_href);

    const { result, rerender } = renderHook(
      ({ hrefs }: { hrefs: string[] }) => useVersionSummaries(hrefs),
      { wrapper: wrapperFor(client), initialProps: { hrefs: first } },
    );
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(list.queries).toHaveLength(1);

    rerender({ hrefs: second });

    await waitFor(() => expect(list.queries).toHaveLength(2));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.counts.size).toBe(20);
    expect(list.queries[1].get('pulp_href__in')?.split(',')).toEqual(
      second.slice(10),
    );
  });

  it('gives a repository without a latest version no count and sends nothing for it', async () => {
    const rows = versions(2);
    const list = versionSummaryHandler({ patched: true, versions: rows });
    server.use(list.handler);
    const hrefs = [null, rows[0].pulp_href, undefined, rows[1].pulp_href, ''];

    const { result } = renderHook(() => useVersionSummaries(hrefs), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(Array.from(result.current.counts.keys())).toEqual([
      rows[0].pulp_href,
      rows[1].pulp_href,
    ]);
    expect(list.queries[0].get('pulp_href__in')).toBe(
      `${rows[0].pulp_href},${rows[1].pulp_href}`,
    );
  });

  it('is ready at once, with no request, for no address', () => {
    const list = versionSummaryHandler({ patched: true, versions: [] });
    server.use(list.handler);

    const { result } = renderHook(() => useVersionSummaries([null]), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    expect(result.current.state).toBe('ready');
    expect(list.queries).toHaveLength(0);
  });

  it('turns the column into an unsupported state after one refused request and asks no more in the session', async () => {
    const rows = versions(500);
    const list = versionSummaryHandler({ patched: false, versions: rows });
    server.use(list.handler);
    const hrefs = rows.map((row) => row.pulp_href);
    const client = createTestQueryClient();

    const first = renderHook(() => useVersionSummaries(hrefs), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(first.result.current.state).toBe('unsupported'));
    // no other chunk was sent while the first was open, and none after it
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(list.queries).toHaveLength(1);
    expect(first.result.current.counts.size).toBe(0);
    expect(client.getQueryData(versionSummaryKeys.support)).toEqual({
      state: 'unsupported',
    });

    // a screen that mounts later reads the flag and probes nothing
    const later = renderHook(() => useVersionSummaries(hrefs.slice(0, 5)), {
      wrapper: wrapperFor(client),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(later.result.current.state).toBe('unsupported');
    expect(list.queries).toHaveLength(1);
  });

  it('does not take another failure for an unsupported server, and reads again on retry', async () => {
    const rows = versions(3);
    let healthy = false;
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(`*${VERSIONS}`, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return healthy
          ? HttpResponse.json({
              count: 3,
              next: null,
              previous: null,
              results: rows,
            })
          : HttpResponse.json({ detail: 'down' }, { status: 500 });
      }),
    );
    const client = createTestQueryClient();
    const hrefs = rows.map((row) => row.pulp_href);

    const { result } = renderHook(() => useVersionSummaries(hrefs), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(client.getQueryData(versionSummaryKeys.support)).toBeUndefined();

    healthy = true;
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.counts.size).toBe(3);
    expect(seen).toHaveLength(2);
  });

  it('keeps a refusal of a later chunk an error once the server is known to support the filter', async () => {
    const rows = versions(60);
    const hrefs = rows.map((row) => row.pulp_href);
    const chunks = RepositoryVersionClient.chunks(hrefs);
    expect(chunks.length).toBeGreaterThan(1);
    server.use(
      http.get(`*${VERSIONS}`, ({ request }) => {
        const asked = new URL(request.url).searchParams.get('pulp_href__in');
        return asked?.startsWith(chunks[0][0])
          ? HttpResponse.json({
              count: chunks[0].length,
              next: null,
              previous: null,
              results: rows.filter((row) => chunks[0].includes(row.pulp_href)),
            })
          : HttpResponse.json({ pulp_href__in: ['bad'] }, { status: 400 });
      }),
    );
    const client = createTestQueryClient();

    const { result } = renderHook(() => useVersionSummaries(hrefs), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(client.getQueryData(versionSummaryKeys.support)).toEqual({
      state: 'supported',
    });
    expect(result.current.counts.size).toBe(chunks[0].length);
  });

  it('sends nothing while the session has ended', async () => {
    const rows = versions(3);
    const list = versionSummaryHandler({ patched: true, versions: rows });
    server.use(list.handler);
    setSignedIn(true);
    act(() => reportUnauthorized('request'));

    const { result } = renderHook(
      () => useVersionSummaries(rows.map((row) => row.pulp_href)),
      { wrapper: wrapperFor(createTestQueryClient()) },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(list.queries).toHaveLength(0);
    expect(result.current.state).toBe('loading');
  });
});
