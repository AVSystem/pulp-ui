import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { fileDistribution } from 'src/entities/file/distribution';
import { filePublication } from 'src/entities/file/publication';
import { ResponseShapeError } from 'src/entities/response-shape';
import {
  distributionListHandler,
  page,
  pluginDistribution,
  pluginPublication,
  pluginRepository,
  publicationListHandler,
} from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { server } from 'src/test-utils/server';
import {
  DISTRIBUTION_INDEX_FIELDS,
  baseUrlsByRepository,
  publicDistributions,
  useDistributionIndex,
} from './distribution';

const DISTRIBUTIONS = '/pulp/api/v3/distributions/file/file/';
const PUBLICATIONS = '/pulp/api/v3/publications/file/file/';
const TASK = '/pulp/api/v3/tasks/00000000-0000-4000-8000-00000000d001/';

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

// The length of the request a recorded query belongs to, path included.
function urlLength(path: string, query: URLSearchParams): number {
  return `${path}?${query.toString()}`.length;
}

describe('Unit: the file distribution entity', { tags: ['unit'] }, () => {
  it('names the plugin and the object it keys its reads by', () => {
    expect(fileDistribution.app).toBe('file');
    expect(fileDistribution.object).toBe('distribution');
    expect(filePublication.app).toBe('file');
    expect(filePublication.object).toBe('publication');
  });

  it('reads 1,200 distributions on two pages with two requests', async () => {
    const repository = pluginRepository('file');
    const rows = Array.from({ length: 1200 }, (_, index) =>
      pluginDistribution('file', {
        base_path: `d-${index}`,
        repository: repository.pulp_href,
      }),
    );
    const list = distributionListHandler('file', rows);
    server.use(list.handler);

    const read = await fileDistribution.index();

    expect(read).toHaveLength(1200);
    expect(list.queries).toHaveLength(2);
    expect(list.queries.map((query) => query.get('limit'))).toEqual([
      '1000',
      '1000',
    ]);
    expect(list.queries.map((query) => query.get('offset'))).toEqual([
      '0',
      '1000',
    ]);
    for (const query of list.queries) {
      expect(query.getAll('fields')).toEqual([...DISTRIBUTION_INDEX_FIELDS]);
    }
  });

  it('asks only for the fields the lists and dialogs read', () => {
    expect([...DISTRIBUTION_INDEX_FIELDS]).toEqual([
      'pulp_href',
      'name',
      'base_path',
      'base_url',
      'repository',
      'publication',
      'repository_version',
      'content_guard',
      'pulp_labels',
      'pulp_created',
      'checkpoint',
    ]);
  });

  it('stops at a page that comes back empty even when it names a next page', async () => {
    const seen: string[] = [];
    server.use(
      http.get(`*${DISTRIBUTIONS}`, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset');
        seen.push(String(offset));
        return HttpResponse.json(
          offset === '0'
            ? {
                ...page([pluginDistribution('file')], { count: 5 }),
                next: 'x',
              }
            : { count: 5, next: 'x', previous: null, results: [] },
        );
      }),
    );

    expect(await fileDistribution.index()).toHaveLength(1);
    expect(seen).toEqual(['0', '1']);
  });

  it('keeps a row that shows on two pages once', async () => {
    const row = pluginDistribution('file');
    server.use(
      http.get(`*${DISTRIBUTIONS}`, ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset');
        return HttpResponse.json(
          offset === '0'
            ? { ...page([row], { count: 2 }), next: 'x' }
            : page([row, pluginDistribution('file')], { count: 2 }),
        );
      }),
    );

    expect(await fileDistribution.index()).toHaveLength(2);
  });

  it('refuses an answer whose address is not a path of this server', async () => {
    server.use(
      http.get(`*${DISTRIBUTIONS}`, () =>
        HttpResponse.json(
          page([
            pluginDistribution('file', {
              pulp_href: 'https://elsewhere.example/x/',
            }),
          ]),
        ),
      ),
    );

    await expect(fileDistribution.index()).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  it('reads, updates and removes a distribution by its address', async () => {
    const row = pluginDistribution('file', { name: 'a' });
    server.use(
      http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)),
      http.patch(`*${row.pulp_href}`, () => HttpResponse.json({ task: TASK })),
      http.delete(`*${row.pulp_href}`, () =>
        HttpResponse.json({ task: TASK }, { status: 202 }),
      ),
    );

    expect(await fileDistribution.retrieve(row.pulp_href)).toMatchObject({
      name: 'a',
      base_url: row.base_url,
    });
    expect(await fileDistribution.update(row.pulp_href, { name: 'b' })).toEqual(
      { kind: 'task', task: TASK },
    );
    expect(await fileDistribution.remove(row.pulp_href)).toBe(TASK);
  });
});

describe('Unit: the file publication entity', { tags: ['unit'] }, () => {
  it('splits the addresses into reads whose URL stays under the budget', () => {
    const hrefs = Array.from(
      { length: 200 },
      () => pluginPublication('file').pulp_href,
    );

    const chunks = filePublication.chunks(hrefs);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(hrefs);
    expect(filePublication.chunks([])).toEqual([]);
  });

  it('sends every chunk as a request no longer than the budget', async () => {
    const rows = Array.from({ length: 200 }, () => pluginPublication('file'));
    const list = publicationListHandler('file', rows);
    server.use(list.handler);

    for (const chunk of filePublication.chunks(
      rows.map((row) => row.pulp_href),
    )) {
      await filePublication.ofHrefs(chunk);
    }

    expect(list.queries.length).toBeGreaterThan(1);
    for (const query of list.queries) {
      expect(urlLength(PUBLICATIONS, query)).toBeLessThanOrEqual(3500);
    }
  });

  it('reads one chunk with the fields the index needs and sends nothing for none', async () => {
    const repository = pluginRepository('file');
    const wanted = pluginPublication('file', {
      repository: repository.pulp_href,
    });
    const other = pluginPublication('file');
    const list = publicationListHandler('file', [wanted, other]);
    server.use(list.handler);

    const read = await filePublication.ofHrefs([wanted.pulp_href]);

    expect(read.map((row) => row.pulp_href)).toEqual([wanted.pulp_href]);
    expect(list.queries[0].get('pulp_href__in')).toBe(wanted.pulp_href);
    expect(list.queries[0].getAll('fields')).toEqual([
      'pulp_href',
      'repository',
      'repository_version',
    ]);

    expect(await filePublication.ofHrefs([])).toEqual([]);
    expect(list.queries).toHaveLength(1);
  });
});

describe('Unit: baseUrlsByRepository', { tags: ['unit'] }, () => {
  it('maps repository-bound, version-bound and publication-bound distributions', () => {
    const a = pluginRepository('file');
    const b = pluginRepository('file');
    const publication = pluginPublication('file', { repository: a.pulp_href });
    const rows = [
      pluginDistribution('file', {
        base_path: 'by-repository',
        repository: a.pulp_href,
      }),
      pluginDistribution('file', {
        base_path: 'by-version',
        repository_version: `${a.pulp_href}versions/3/`,
      }),
      pluginDistribution('file', {
        base_path: 'by-publication',
        publication: publication.pulp_href,
      }),
      pluginDistribution('file', {
        base_path: 'other',
        repository: b.pulp_href,
      }),
      pluginDistribution('file', { base_path: 'bound-to-nothing' }),
    ];

    const map = baseUrlsByRepository(
      rows.map((row) => ({ ...row, pulp_labels: {} })),
      new Map([[publication.pulp_href, a.pulp_href]]),
    );

    expect(Array.from(map.keys()).sort()).toEqual(
      [a.pulp_href, b.pulp_href].sort(),
    );
    expect(map.get(a.pulp_href)?.length).toBe(3);
    expect(map.get(a.pulp_href)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: expect.stringContaining('/by-repository/'),
        }),
        expect.objectContaining({
          url: expect.stringContaining('/by-version/'),
        }),
        expect.objectContaining({
          url: expect.stringContaining('/by-publication/'),
        }),
      ]),
    );
    expect(map.get(b.pulp_href)).toEqual([
      expect.objectContaining({ url: expect.stringContaining('/other/') }),
    ]);
  });

  it('names the distribution behind each address and says whether it is public', () => {
    const repository = pluginRepository('file');
    const guard =
      '/pulp/api/v3/contentguards/core/rbac/00000000-0000-4000-8000-000000000001/';
    const rows = [
      pluginDistribution('file', {
        name: 'open',
        base_path: 'open',
        repository: repository.pulp_href,
        content_guard: null,
      }),
      pluginDistribution('file', {
        name: 'closed',
        base_path: 'closed',
        repository: repository.pulp_href,
        content_guard: guard,
      }),
    ];

    const map = baseUrlsByRepository(
      rows.map((row) => ({ ...row, pulp_labels: {} })),
      new Map(),
    );

    expect(map.get(repository.pulp_href)).toEqual([
      {
        url: rows[1]?.base_url,
        name: 'closed',
        isPublic: false,
      },
      { url: rows[0]?.base_url, name: 'open', isPublic: true },
    ]);
  });

  it('never takes a row that does not carry the guard field for a public one', () => {
    const repository = pluginRepository('file');
    const cut = Object.fromEntries(
      Object.entries(
        pluginDistribution('file', {
          name: 'cut',
          repository: repository.pulp_href,
        }),
      ).filter(([key]) => key !== 'content_guard'),
    );

    const map = baseUrlsByRepository(
      [{ ...cut, pulp_labels: {} } as never],
      new Map(),
    );

    expect(map.get(repository.pulp_href)).toEqual([
      expect.objectContaining({ name: 'cut', isPublic: false }),
    ]);
  });

  it('leaves a publication-bound distribution out when its publication is unknown', () => {
    const rows = [
      pluginDistribution('file', {
        publication: '/pulp/api/v3/publications/file/file/unknown/',
      }),
    ];

    expect(
      baseUrlsByRepository(
        rows.map((row) => ({ ...row, pulp_labels: {} })),
        new Map(),
      ).size,
    ).toBe(0);
  });
});

describe('Unit: publicDistributions', { tags: ['unit'] }, () => {
  const GUARD =
    '/pulp/api/v3/contentguards/core/rbac/00000000-0000-4000-8000-000000000001/';

  it('names the distributions the server says have no content guard', () => {
    const open = pluginDistribution('file', {
      name: 'open',
      content_guard: null,
    });
    const closed = pluginDistribution('file', {
      name: 'closed',
      content_guard: GUARD,
    });

    expect(publicDistributions([open, closed])).toEqual([open.pulp_href]);
  });

  it('never takes a row that does not carry the field for a public one', () => {
    const row = pluginDistribution('file', { name: 'unknown' });
    delete (row as { content_guard?: unknown }).content_guard;

    expect(publicDistributions([row])).toEqual([]);
  });

  it('names none for no rows', () => {
    expect(publicDistributions([])).toEqual([]);
  });
});

describe('Unit: useDistributionIndex', { tags: ['unit'] }, () => {
  function fixture() {
    const a = pluginRepository('file', { name: 'a' });
    const b = pluginRepository('file', { name: 'b' });
    const publication = pluginPublication('file', { repository: a.pulp_href });
    const byRepository = pluginDistribution('file', {
      name: 'team-stable',
      base_path: 'team/stable',
      repository: a.pulp_href,
    });
    const byVersion = pluginDistribution('file', {
      name: 'frozen',
      base_path: 'frozen',
      repository_version: `${a.pulp_href}versions/2/`,
    });
    const byPublication = pluginDistribution('file', {
      name: 'published',
      base_path: 'published',
      publication: publication.pulp_href,
    });
    const other = pluginDistribution('file', {
      name: 'other',
      base_path: 'Other/Team',
      repository: b.pulp_href,
    });
    return { a, b, publication, byRepository, byVersion, byPublication, other };
  }

  it('reads the index once for any number of subscribers', async () => {
    const rows = Array.from({ length: 1200 }, (_, index) =>
      pluginDistribution('file', {
        base_path: `d-${index}`,
        repository: pluginRepository('file').pulp_href,
      }),
    );
    const list = distributionListHandler('file', rows);
    const publications = publicationListHandler('file', []);
    server.use(list.handler, publications.handler);
    const client = createTestQueryClient();

    const first = renderHook(
      () => useDistributionIndex(fileDistribution, filePublication),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(first.result.current.status).toBe('success'));
    expect(list.queries).toHaveLength(2);

    const second = renderHook(
      () => useDistributionIndex(fileDistribution, filePublication),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(second.result.current.status).toBe('success'));

    expect(list.queries).toHaveLength(2);
    expect(publications.queries).toHaveLength(0);
    expect(second.result.current.baseUrlsByRepository?.size).toBe(1200);
  });

  it('maps every kind of binding to its repository through chunked publication reads', async () => {
    const f = fixture();
    const list = distributionListHandler('file', [
      f.byRepository,
      f.byVersion,
      f.byPublication,
      f.other,
    ]);
    const publications = publicationListHandler('file', [
      f.publication,
      pluginPublication('file'),
    ]);
    server.use(list.handler, publications.handler);

    const { result } = renderHook(
      () => useDistributionIndex(fileDistribution, filePublication),
      { wrapper: wrapperFor(createTestQueryClient()) },
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    const map = result.current.baseUrlsByRepository;
    expect(map?.get(f.a.pulp_href)).toHaveLength(3);
    expect(map?.get(f.b.pulp_href)).toHaveLength(1);
    expect(publications.queries).toHaveLength(1);
    expect(publications.queries[0].get('pulp_href__in')).toBe(
      f.publication.pulp_href,
    );
  });

  it('reads only the publications the distributions are bound to, in chunks under the budget', async () => {
    const bound = Array.from({ length: 120 }, () => {
      const repository = pluginRepository('file');
      return {
        repository,
        publication: pluginPublication('file', {
          repository: repository.pulp_href,
        }),
      };
    });
    const list = distributionListHandler('file', [
      ...bound.map(({ publication }) =>
        pluginDistribution('file', { publication: publication.pulp_href }),
      ),
      pluginDistribution('file', { repository: bound[0].repository.pulp_href }),
    ]);
    const publications = publicationListHandler('file', [
      ...bound.map(({ publication }) => publication),
      pluginPublication('file'),
    ]);
    server.use(list.handler, publications.handler);

    const { result } = renderHook(
      () => useDistributionIndex(fileDistribution, filePublication),
      { wrapper: wrapperFor(createTestQueryClient()) },
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    const asked = publications.queries.flatMap(
      (query) => query.get('pulp_href__in')?.split(',') ?? [],
    );
    expect(asked.sort()).toEqual(
      bound.map(({ publication }) => publication.pulp_href).sort(),
    );
    expect(publications.queries.length).toBeGreaterThan(1);
    for (const query of publications.queries) {
      expect(urlLength(PUBLICATIONS, query)).toBeLessThanOrEqual(3500);
    }
    expect(result.current.baseUrlsByRepository?.size).toBe(120);
  });

  it('needs no publication entity for a plugin that has none', async () => {
    const f = fixture();
    const list = distributionListHandler('file', [
      f.byRepository,
      f.byPublication,
    ]);
    const publications = publicationListHandler('file', [f.publication]);
    server.use(list.handler, publications.handler);

    const { result } = renderHook(
      () => useDistributionIndex(fileDistribution),
      {
        wrapper: wrapperFor(createTestQueryClient()),
      },
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(publications.queries).toHaveLength(0);
    expect(result.current.baseUrlsByRepository?.get(f.a.pulp_href)).toEqual([
      expect.objectContaining({ url: f.byRepository.base_url }),
    ]);
  });

  it('offers the distributions of one repository and the repositories matching a base path', async () => {
    const f = fixture();
    server.use(
      distributionListHandler('file', [
        f.byRepository,
        f.byVersion,
        f.byPublication,
        f.other,
      ]).handler,
      publicationListHandler('file', [f.publication]).handler,
    );

    const { result } = renderHook(
      () => useDistributionIndex(fileDistribution, filePublication),
      { wrapper: wrapperFor(createTestQueryClient()) },
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(
      result.current
        .distributionsOfRepository(f.a.pulp_href)
        ?.map((row) => row.name)
        .sort(),
    ).toEqual(['frozen', 'published', 'team-stable']);
    expect(
      result.current.distributionsOfRepository(f.b.pulp_href),
    ).toHaveLength(1);
    expect(
      result.current.distributionsOfRepository(
        '/pulp/api/v3/repositories/file/file/none/',
      ),
    ).toEqual([]);
    expect(
      Array.from(
        result.current.repositoriesMatchingBasePath('team') ?? [],
      ).sort(),
    ).toEqual([f.a.pulp_href, f.b.pulp_href].sort());
    expect(
      Array.from(result.current.repositoriesMatchingBasePath('stable') ?? []),
    ).toEqual([f.a.pulp_href]);
  });

  it('offers the public distributions once the index is complete and none before', async () => {
    const guard =
      '/pulp/api/v3/contentguards/core/rbac/00000000-0000-4000-8000-000000000002/';
    const open = pluginDistribution('file', {
      name: 'open',
      content_guard: null,
    });
    const closed = pluginDistribution('file', {
      name: 'closed',
      content_guard: guard,
    });
    const list = distributionListHandler('file', [open, closed]);
    server.use(list.handler);

    const { result } = renderHook(
      () => useDistributionIndex(fileDistribution),
      { wrapper: wrapperFor(createTestQueryClient()) },
    );

    expect(result.current.publicDistributions()).toBeNull();
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.publicDistributions()).toEqual([open.pulp_href]);
    expect(list.queries[0]?.getAll('fields')).toContain('content_guard');
  });

  it('is an error state and no map when the index read fails', async () => {
    server.use(
      http.get(`*${DISTRIBUTIONS}`, () =>
        HttpResponse.json({ detail: 'down' }, { status: 500 }),
      ),
    );

    const { result } = renderHook(
      () => useDistributionIndex(fileDistribution, filePublication),
      { wrapper: wrapperFor(createTestQueryClient()) },
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.baseUrlsByRepository).toBeUndefined();
    expect(result.current.distributionsOfRepository('/x/')).toBeNull();
    expect(result.current.repositoriesMatchingBasePath('x')).toBeNull();
  });

  it('is an error state when a publication read fails, and retry reads again', async () => {
    const f = fixture();
    let healthy = false;
    server.use(
      distributionListHandler('file', [f.byPublication]).handler,
      http.get(`*${PUBLICATIONS}`, () =>
        healthy
          ? HttpResponse.json(page([f.publication]))
          : HttpResponse.json({ detail: 'down' }, { status: 500 }),
      ),
    );

    const { result } = renderHook(
      () => useDistributionIndex(fileDistribution, filePublication),
      { wrapper: wrapperFor(createTestQueryClient()) },
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.baseUrlsByRepository).toBeUndefined();

    healthy = true;
    result.current.retry();

    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.baseUrlsByRepository?.get(f.a.pulp_href)).toEqual([
      expect.objectContaining({ url: f.byPublication.base_url }),
    ]);
  });
});

describe('Unit: reading a distribution by name', { tags: ['unit'] }, () => {
  it('asks for one row with the name filter and returns it', async () => {
    const wanted = pluginDistribution('file', { name: 'tools-dist' });
    const lab = distributionListHandler('file', [
      pluginDistribution('file', { name: 'other' }),
      wanted,
    ]);
    server.use(lab.handler);

    const found = await fileDistribution.byName('tools-dist');

    expect(found?.pulp_href).toBe(wanted.pulp_href);
    expect(lab.queries).toHaveLength(1);
    expect(lab.queries[0]?.get('name')).toBe('tools-dist');
    expect(lab.queries[0]?.get('limit')).toBe('1');
  });

  it('answers null for a name no distribution has', async () => {
    server.use(
      distributionListHandler('file', [
        pluginDistribution('file', { name: 'other' }),
      ]).handler,
    );

    expect(await fileDistribution.byName('missing')).toBeNull();
  });

  it('answers null for a row of another name, which means the filter was not applied', async () => {
    server.use(
      http.get(`*${DISTRIBUTIONS}`, () =>
        HttpResponse.json(
          page([pluginDistribution('file', { name: 'first-of-all' })]),
        ),
      ),
    );

    expect(await fileDistribution.byName('tools-dist')).toBeNull();
  });

  it('sends no request for an empty name', async () => {
    const lab = distributionListHandler('file', [
      pluginDistribution('file', { name: 'first-of-all' }),
    ]);
    server.use(lab.handler);

    expect(await fileDistribution.byName('')).toBeNull();
    expect(lab.queries).toHaveLength(0);
  });
});
