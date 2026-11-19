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

export interface IRepositoryVersion {
  pulp_href: string;
  pulp_created: string;
  number: number;
  repository: string;
  base_version: string | null;
  content_summary: { added: object; removed: object; present: object };
}

// A version of the given repository; its href starts with the repository's
// own href, the way the server builds it.
export function repositoryVersion(
  repo: { pulp_href: string },
  number: number,
  overrides: Partial<IRepositoryVersion> = {},
): IRepositoryVersion {
  return {
    pulp_href: `${repo.pulp_href}versions/${number}/`,
    pulp_created: '2000-01-01T00:00:00.000000Z',
    number,
    repository: repo.pulp_href,
    base_version: null,
    content_summary: { added: {}, removed: {}, present: {} },
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

// A Python distribution as the server returns it: the pull-through remote and
// the upload permission come with it.
export function pythonDistribution(
  overrides: Partial<IDistribution> = {},
): IDistribution {
  return distribution({
    pulp_href: href('distributions/python/pypi'),
    remote: null,
    allow_uploads: true,
    ...overrides,
  });
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
  // the server always names the version a publication was made from
  const repository = overrides.repository ?? null;
  return {
    pulp_href: href('publications/file/file'),
    repository,
    repository_version: repository ? `${repository}versions/0/` : null,
    pulp_created: '2000-01-01T00:00:00.000000Z',
    ...overrides,
  };
}

export interface IRemote {
  pulp_href: string;
  name: string;
  url: string;
  policy: string;
  pulp_created: string;
  [field: string]: unknown;
}

// A remote as the server returns it: the secret fields are not carried, only
// listed under hidden_fields with whether a value is set.
export function remote(overrides: Partial<IRemote> = {}): IRemote {
  return {
    pulp_href: href('remotes/file/file'),
    name: `remote-${sequence}`,
    url: 'https://pulp.example/index/',
    policy: 'immediate',
    pulp_created: '2000-01-01T00:00:00.000000Z',
    tls_validation: true,
    ca_cert: null,
    client_cert: null,
    proxy_url: null,
    download_concurrency: null,
    rate_limit: null,
    hidden_fields: [
      'client_key',
      'proxy_username',
      'proxy_password',
      'username',
      'password',
    ].map((field) => ({ name: field, is_set: false })),
    ...overrides,
  };
}

export interface ITask {
  pulp_href: string;
  state: string;
  error: { description: string } | null;
  pulp_created: string;
  [field: string]: unknown;
}

// A task as the server returns it; the state defaults to a finished one.
export function task(overrides: Partial<ITask> = {}): ITask {
  return {
    pulp_href: href('tasks'),
    state: 'completed',
    error: null,
    pulp_created: '2000-01-01T00:00:00.000000Z',
    ...overrides,
  };
}

export interface ITaskRow {
  pulp_href: string;
  prn: string;
  name: string;
  state: string;
  pulp_created: string;
  started_at: string | null;
  finished_at: string | null;
  error: { description: string } | null;
  worker: string | null;
  logging_cid: string;
  parent_task: string | null;
  child_tasks: string[];
  created_resources: string[];
  reserved_resources_record: string[];
  progress_reports: object[];
  [field: string]: unknown;
}

// A task as the task list and the task screens read it: every field the
// server lists is present, with a relative address and a finished state.
export function taskRow(overrides: Partial<ITaskRow> = {}): ITaskRow {
  const id = href('tasks');
  return {
    pulp_href: id,
    prn: `prn:core.task:${id.split('/').filter(Boolean).pop()}`,
    name: `pulp_task.${sequence}`,
    state: 'completed',
    pulp_created: '2000-01-01T00:00:00.000000Z',
    started_at: '2000-01-01T00:00:01.000000Z',
    finished_at: '2000-01-01T00:00:02.000000Z',
    error: null,
    worker: null,
    logging_cid: `cid-${sequence}`,
    parent_task: null,
    child_tasks: [],
    created_resources: [],
    reserved_resources_record: [],
    progress_reports: [],
    ...overrides,
  };
}

// One page of a task list answer.
export function taskPage(
  rows: ITaskRow[],
  options: { count?: number; next?: string } = {},
): IPage<ITaskRow> {
  return page(rows, options);
}

export interface IContentGuard {
  pulp_href: string;
  name: string;
  pulp_created: string;
  [field: string]: unknown;
}

// A content guard as the server returns it from the combined contentguards
// list.
export function contentGuard(
  overrides: Partial<IContentGuard> = {},
): IContentGuard {
  return {
    pulp_href: href('contentguards/core/rbac'),
    name: `guard-${sequence}`,
    pulp_created: '2000-01-01T00:00:00.000000Z',
    ...overrides,
  };
}

export interface IGroup {
  pulp_href: string;
  id: number;
  name: string;
}

// A group as the server returns it; the numeric id follows the href sequence.
export function group(overrides: Partial<IGroup> = {}): IGroup {
  const id = bump();
  return {
    pulp_href: `/pulp/api/v3/groups/${id}/`,
    id,
    name: `group-${id}`,
    ...overrides,
  };
}

export interface IUser {
  pulp_href: string;
  id: number;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  is_staff: boolean;
  is_active: boolean;
  date_joined: string;
  groups: IGroup[];
  [field: string]: unknown;
}

// A user as the server returns it, with no group and a blank name.
export function user(overrides: Partial<IUser> = {}): IUser {
  const id = bump();
  return {
    pulp_href: `/pulp/api/v3/users/${id}/`,
    id,
    username: `user-${id}`,
    first_name: '',
    last_name: '',
    email: '',
    is_staff: false,
    is_active: true,
    date_joined: '2000-01-01T00:00:00.000000Z',
    groups: [],
    ...overrides,
  };
}

export interface IRole {
  pulp_href: string;
  name: string;
  description: string;
  locked: boolean;
  permissions: string[];
  pulp_created: string;
}

// A role as the server returns it; unlocked, so it can be edited.
export function role(overrides: Partial<IRole> = {}): IRole {
  return {
    pulp_href: href('roles'),
    name: `role-${sequence}`,
    description: '',
    locked: false,
    permissions: [],
    pulp_created: '2000-01-01T00:00:00.000000Z',
    ...overrides,
  };
}

export interface ISigningService {
  pulp_href: string;
  name: string;
  pubkey_fingerprint: string;
  public_key: string;
  pulp_created: string;
}

// A signing service as the server returns it.
export function signingService(
  overrides: Partial<ISigningService> = {},
): ISigningService {
  return {
    pulp_href: href('signing-services'),
    name: `signer-${sequence}`,
    pubkey_fingerprint: '0'.repeat(40),
    public_key: 'public key text',
    pulp_created: '2000-01-01T00:00:00.000000Z',
    ...overrides,
  };
}
