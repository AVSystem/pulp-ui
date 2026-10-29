import { HttpResponse, http } from 'msw';

// Builders and list handlers that produce Pulp-shaped responses, so a test
// never hand-writes a response shape. Every host is a reserved one.

const CONTENT_HOST = 'https://pulp.example';

export interface IPage<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// One page of a Pulp list response. The count is the size of the whole list,
// which equals the number of results unless the list continues on another page.
export function page<T>(
  results: T[],
  { count, next }: { count?: number; next?: string } = {},
): IPage<T> {
  return {
    count: count ?? results.length,
    next: next ?? null,
    previous: null,
    results,
  };
}

const DEFAULT_PAGE_SIZE = 100;

// A GET handler for a list endpoint, to pass to server.use. It answers offset
// and limit requests with slices of the rows and a next link until the last
// page, as the server does; pageSize caps the rows of one page whatever the
// request asks for. matching keeps only the rows a filter query selects, the
// way a server filter does; without it every row is answered whatever the
// query says. The query of every request it answers is recorded in queries, in
// order, for assertions.
export function listOf<T>(
  path: string,
  allRows: T[],
  {
    pageSize = DEFAULT_PAGE_SIZE,
    matching,
  }: {
    pageSize?: number;
    matching?: (row: T, query: URLSearchParams) => boolean;
  } = {},
) {
  const queries: URLSearchParams[] = [];

  const handler = http.get(`*${path}`, ({ request }) => {
    const url = new URL(request.url);
    queries.push(new URLSearchParams(url.searchParams));
    const rows = matching
      ? allRows.filter((row) => matching(row, url.searchParams))
      : allRows;

    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const requested = Number(url.searchParams.get('limit')) || pageSize;
    const limit = Math.min(requested, pageSize);

    const link = (to: number) => {
      const target = new URL(url);
      target.searchParams.set('offset', String(to));
      target.searchParams.set('limit', String(limit));
      return target.toString();
    };

    const body = page(rows.slice(offset, offset + limit), {
      count: rows.length,
      ...(offset + limit < rows.length ? { next: link(offset + limit) } : {}),
    });
    body.previous = offset > 0 ? link(Math.max(0, offset - limit)) : null;

    return HttpResponse.json(body);
  });

  return { handler, queries };
}

let sequence = 0;
const bump = () => ++sequence;

// The sequence number makes every href unique and readable in a failure.
const href = (collection: string) =>
  `/pulp/api/v3/${collection}/00000000-0000-4000-8000-${String(bump()).padStart(12, '0')}/`;

export interface IRepository {
  pulp_href: string;
  name: string;
  pulp_created: string;
  versions_href: string;
  latest_version_href: string;
  [field: string]: unknown;
}

export function repository(overrides: Partial<IRepository> = {}): IRepository {
  const id = href('repositories/file/file');
  return {
    pulp_href: id,
    name: `repository-${sequence}`,
    pulp_created: '2000-01-01T00:00:00.000000Z',
    versions_href: `${id}versions/`,
    latest_version_href: `${id}versions/0/`,
    ...overrides,
  };
}

export interface IDistribution {
  pulp_href: string;
  name: string;
  base_path: string;
  base_url: string;
  repository: string | null;
  publication: string | null;
  repository_version: string | null;
  content_guard: string | null;
  pulp_created: string;
  [field: string]: unknown;
}

// base_url follows base_path unless a test overrides it, the way the server
// derives it.
export function distribution(
  overrides: Partial<IDistribution> = {},
): IDistribution {
  const id = href('distributions/file/file');
  const basePath = overrides.base_path ?? `distribution-${sequence}`;
  return {
    pulp_href: id,
    name: basePath,
    base_path: basePath,
    base_url: `${CONTENT_HOST}/pulp/content/${basePath}/`,
    repository: null,
    publication: null,
    repository_version: null,
    content_guard: null,
    pulp_created: '2000-01-01T00:00:00.000000Z',
    ...overrides,
  };
}

export interface IPublication {
  pulp_href: string;
  repository: string | null;
  repository_version: string | null;
  pulp_created: string;
  [field: string]: unknown;
}

export function publication(
  overrides: Partial<IPublication> = {},
): IPublication {
  return {
    pulp_href: href('publications/file/file'),
    repository: null,
    repository_version: null,
    pulp_created: '2000-01-01T00:00:00.000000Z',
    ...overrides,
  };
}
