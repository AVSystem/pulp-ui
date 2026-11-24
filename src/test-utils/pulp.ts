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
// query says. ordered sorts them the way a server ordering does. The query of every request it answers is recorded in queries, in
// order, for assertions.
export function listOf<T>(
  path: string,
  allRows: T[],
  {
    pageSize = DEFAULT_PAGE_SIZE,
    matching,
    ordered,
    projected,
    refusing,
  }: {
    pageSize?: number;
    matching?: (row: T, query: URLSearchParams) => boolean;
    // Puts the selected rows in the order the query asks for, before they are
    // cut into a page, the way a server ordering does.
    ordered?: (rows: T[], query: URLSearchParams) => T[];
    // Cuts each row of the page to what the query asks for, the way the
    // `fields` parameter of the server does.
    projected?: (row: T, query: URLSearchParams) => unknown;
    // The body of a 400 answer for a query the server refuses, or undefined
    // when the query is acceptable.
    refusing?: (query: URLSearchParams) => unknown;
  } = {},
) {
  const queries: URLSearchParams[] = [];

  const handler = http.get(`*${path}`, ({ request }) => {
    const url = new URL(request.url);
    queries.push(new URLSearchParams(url.searchParams));
    const refusal = refusing?.(url.searchParams);
    if (refusal !== undefined) {
      return HttpResponse.json(refusal, { status: 400 });
    }
    const selected = matching
      ? allRows.filter((row) => matching(row, url.searchParams))
      : allRows;
    const rows = ordered ? ordered(selected, url.searchParams) : selected;

    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const requested = Number(url.searchParams.get('limit')) || pageSize;
    const limit = Math.min(requested, pageSize);

    const link = (to: number) => {
      const target = new URL(url);
      target.searchParams.set('offset', String(to));
      target.searchParams.set('limit', String(limit));
      return target.toString();
    };

    const slice = rows.slice(offset, offset + limit);
    const body: IPage<unknown> = page(
      projected ? slice.map((row) => projected(row, url.searchParams)) : slice,
      {
        count: rows.length,
        ...(offset + limit < rows.length ? { next: link(offset + limit) } : {}),
      },
    );
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

// The plugins the repository and remote builders know: the path segment of
// their addresses and the model names their PRNs carry.
const PLUGINS = {
  file: {
    segment: 'file/file',
    repository: 'file.filerepository',
    remote: 'file.fileremote',
    publication: 'file/file',
  },
  deb: {
    segment: 'deb/apt',
    repository: 'deb.aptrepository',
    remote: 'deb.aptremote',
    publication: 'deb/apt',
  },
  rpm: {
    segment: 'rpm/rpm',
    repository: 'rpm.rpmrepository',
    remote: 'rpm.rpmremote',
    publication: 'rpm/rpm',
  },
  python: {
    segment: 'python/python',
    repository: 'python.pythonrepository',
    remote: 'python.pythonremote',
    publication: 'python/pypi',
  },
} as const;

export type TestPlugin = keyof typeof PLUGINS;

// Every plugin that has distributions: the path segment below `distributions/`
// and the model name its PRNs carry. Plugins with no repository or remote
// builder here (maven, npm, ansible, container) have distributions only.
const DISTRIBUTIONS = {
  file: { segment: 'file/file', model: 'file.filedistribution' },
  deb: { segment: 'deb/apt', model: 'deb.aptdistribution' },
  rpm: { segment: 'rpm/rpm', model: 'rpm.rpmdistribution' },
  python: { segment: 'python/pypi', model: 'python.pythondistribution' },
  maven: { segment: 'maven/maven', model: 'maven.mavendistribution' },
  npm: { segment: 'npm/npm', model: 'npm.npmdistribution' },
  ansible: {
    segment: 'ansible/ansible',
    model: 'ansible.ansibledistribution',
  },
  container: {
    segment: 'container/container',
    model: 'container.containerdistribution',
  },
} as const;

export type TestDistributionPlugin = keyof typeof DISTRIBUTIONS;

// The id an address ends in, which a PRN carries too.
const idOf = (address: string) => address.split('/').filter(Boolean).pop();

// A repository of the given plugin as the server returns it: the address of
// that plugin, its PRN, its versions and the remote and labels a screen reads.
export function pluginRepository(
  plugin: TestPlugin,
  overrides: Partial<IRepository> = {},
): IRepository {
  const { segment, repository: model } = PLUGINS[plugin];
  const id = href(`repositories/${segment}`);
  return {
    pulp_href: id,
    prn: `prn:${model}:${idOf(id)}`,
    name: `repository-${sequence}`,
    pulp_created: '2000-01-01T00:00:00.000000Z',
    versions_href: `${id}versions/`,
    latest_version_href: `${id}versions/0/`,
    description: null,
    retain_repo_versions: null,
    pulp_labels: {},
    remote: null,
    ...overrides,
  };
}

// A remote of the given plugin as the server returns it: remote() with the
// address and the PRN of that plugin and an empty set of labels.
export function pluginRemote(
  plugin: TestPlugin,
  overrides: Partial<IRemote> = {},
): IRemote {
  const { segment, remote: model } = PLUGINS[plugin];
  const id = href(`remotes/${segment}`);
  return remote({
    pulp_href: id,
    prn: `prn:${model}:${idOf(id)}`,
    pulp_labels: {},
    ...overrides,
  });
}

// A distribution of the given plugin as the server returns it: distribution()
// with the address, the PRN and the labels of that plugin. An ansible
// distribution also carries the address of its collection source.
export function pluginDistribution(
  plugin: TestDistributionPlugin,
  overrides: Partial<IDistribution> = {},
): IDistribution {
  const { segment, model } = DISTRIBUTIONS[plugin];
  const id = href(`distributions/${segment}`);
  const row = distribution({
    pulp_href: id,
    prn: `prn:${model}:${idOf(id)}`,
    pulp_labels: {},
    ...overrides,
  });
  return plugin === 'ansible'
    ? {
        client_url: `${CONTENT_HOST}/pulp_ansible/galaxy/${row.base_path}/`,
        ...row,
      }
    : row;
}

// The `pulp_type` the server filters the cross-plugin distribution list by,
// for the model name of each row's PRN. The rows themselves carry no type.
const PULP_TYPE_OF_MODEL: Record<string, string> = {
  'file.filedistribution': 'file.file',
  'deb.aptdistribution': 'deb.apt-distribution',
  'rpm.rpmdistribution': 'rpm.rpm',
  'python.pythondistribution': 'python.python',
  'maven.mavendistribution': 'maven.maven',
  'npm.npmdistribution': 'npm.npm',
  'ansible.ansibledistribution': 'ansible.ansible',
  'container.containerdistribution': 'container.container',
  'core.artifactdistribution': 'core.artifact',
};

// A row of the cross-plugin distribution list: what the core list answers for
// a distribution of any plugin. It names neither the publication nor the
// plugin's own client address, and its base URL is always the content path.
export function coreDistributionRow(row: IDistribution): IDistribution {
  const kept = Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => key !== 'publication' && key !== 'client_url',
    ),
  );

  return {
    ...kept,
    base_url: `${CONTENT_HOST}/pulp/content/${row.base_path}/`,
  } as IDistribution;
}

// The row of the distribution a pulpcore server keeps for an artifact, which
// the cross-plugin list holds although no plugin screen shows it.
export function artifactDistribution(
  overrides: Partial<IDistribution> = {},
): IDistribution {
  const id = href('distributions/core/artifacts');
  const digest =
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  return distribution({
    pulp_href: id,
    prn: `prn:core.artifactdistribution:${idOf(id)}`,
    name: digest,
    base_path: digest,
    pulp_labels: {},
    ...overrides,
  });
}

// The cross-plugin distribution list as the server answers it: the filters
// `pulp_type__in` (by the type of each row's PRN), `name__icontains`,
// `base_path__icontains` and `pulp_href__in`, the orderings by name, base path,
// type and creation date, the `fields` cut and the paging of listOf. A request
// with no `pulp_type__in` is answered with every row, artifact rows included,
// as the server does.
export function coreDistributionListHandler(
  rows: IDistribution[],
  { pageSize = 1000 }: { pageSize?: number } = {},
) {
  const path = '/pulp/api/v3/distributions/';
  const typeOf = (row: IDistribution) =>
    PULP_TYPE_OF_MODEL[
      String(row['prn'] ?? '')
        .split(':')[1]
        ?.toLowerCase() ?? ''
    ] ?? 'unknown';
  const list = listOf(path, rows, {
    pageSize,
    matching: (row, query) => {
      const types = inSetOf(query, 'pulp_type__in');
      const hrefs = inSetOf(query, 'pulp_href__in');
      const text = query.get('name__icontains');
      const basePath = query.get('base_path__icontains');
      const select = query.get('pulp_label_select');
      const selected = select === null ? null : labelSelectOf(select);
      return (
        (types === null || types.includes(typeOf(row))) &&
        (hrefs === null || hrefs.includes(row.pulp_href)) &&
        (text === null ||
          row.name.toLowerCase().includes(text.toLowerCase())) &&
        (basePath === null ||
          row.base_path.toLowerCase().includes(basePath.toLowerCase())) &&
        (selected === null ||
          ('matches' in selected &&
            selected.matches((row as { pulp_labels?: Labels }).pulp_labels)))
      );
    },
    refusing: (query) => {
      const select = query.get('pulp_label_select');
      const selected = select === null ? null : labelSelectOf(select);
      return selected && 'refusal' in selected ? [selected.refusal] : undefined;
    },
    ordered: (selected, query) => {
      const ordering = query.get('ordering');
      if (!ordering) {
        return selected;
      }
      const down = ordering.startsWith('-');
      const field = down ? ordering.slice(1) : ordering;
      const value = (row: IDistribution) =>
        field === 'pulp_type' ? typeOf(row) : String(row[field] ?? '');
      return [...selected].sort((a, b) => {
        const order = value(a).localeCompare(value(b));
        return down ? -order : order;
      });
    },
    projected: projectedBy,
  });

  return { ...list, path };
}

// A publication of the given plugin as the server returns it.
export function pluginPublication(
  plugin: TestPlugin,
  overrides: Partial<IPublication> = {},
): IPublication {
  return publication({
    pulp_href: href(`publications/${PLUGINS[plugin].publication}`),
    ...overrides,
  });
}

// Cuts a row to the fields a query names with `fields`, repeated or comma
// separated, the way the server does; without the parameter the row is whole.
export function projectedBy<T extends object>(
  row: T,
  query: URLSearchParams,
): object {
  const names = query
    .getAll('fields')
    .flatMap((value) => value.split(','))
    .filter(Boolean);
  if (names.length === 0) {
    return row;
  }
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => names.includes(key)),
  );
}

// The set of values an `__in` filter carries, or null when the query has no
// such filter.
export function inSetOf(query: URLSearchParams, key: string): string[] | null {
  return query.has(key)
    ? (query.get(key) ?? '').split(',').filter(Boolean)
    : null;
}

// The distributions of a plugin as the server lists them: the filters
// `repository` and `pulp_href__in`, the `fields` cut, and the paging of
// listOf (a page holds at most pageSize rows, 1,000 as on the server).
export function distributionListHandler<T extends { pulp_href: string }>(
  plugin: TestDistributionPlugin,
  rows: T[],
  { pageSize = 1000 }: { pageSize?: number } = {},
) {
  const path = `/pulp/api/v3/distributions/${DISTRIBUTIONS[plugin].segment}/`;
  const list = listOf(path, rows, {
    pageSize,
    matching: (row, query) => {
      const hrefs = inSetOf(query, 'pulp_href__in');
      const repository = query.get('repository');
      const name = query.get('name');
      return (
        (hrefs === null || hrefs.includes(row.pulp_href)) &&
        (name === null || (row as { name?: unknown }).name === name) &&
        (repository === null ||
          (row as { repository?: unknown }).repository === repository)
      );
    },
    projected: projectedBy,
  });

  return { ...list, path };
}

// The publications of a plugin as the server lists them: `pulp_href__in`, the
// `repository` filter and the `fields` cut.
export function publicationListHandler<T extends { pulp_href: string }>(
  plugin: TestPlugin,
  rows: T[],
  { pageSize = 1000 }: { pageSize?: number } = {},
) {
  const path = `/pulp/api/v3/publications/${PLUGINS[plugin].publication}/`;
  const list = listOf(path, rows, {
    pageSize,
    matching: (row, query) => {
      const hrefs = inSetOf(query, 'pulp_href__in');
      const repository = query.get('repository');
      return (
        (hrefs === null || hrefs.includes(row.pulp_href)) &&
        (repository === null ||
          (row as { repository?: unknown }).repository === repository)
      );
    },
    ordered: orderedBy,
    projected: projectedBy,
  });

  return { ...list, path };
}

// The repositories of every plugin through the one list that holds them all.
export function coreRepositoryListHandler<
  T extends { pulp_href: string; name?: string },
>(rows: T[], { pageSize = 1000 }: { pageSize?: number } = {}) {
  const path = '/pulp/api/v3/repositories/';
  const list = listOf(path, rows, {
    pageSize,
    matching: (row, query) => {
      const hrefs = inSetOf(query, 'pulp_href__in');
      const types = inSetOf(query, 'pulp_type__in');
      const name = query.get('name');
      const text = query.get('name__icontains');

      return (
        (hrefs === null || hrefs.includes(row.pulp_href)) &&
        (types === null || types.includes(repositoryPulpType(row))) &&
        (name === null || row.name === name) &&
        (text === null ||
          (row.name ?? '').toLowerCase().includes(text.toLowerCase()))
      );
    },
    ordered: orderedBy,
    projected: projectedBy,
  });

  return { ...list, path };
}

// The `pulp_type` the server gives a repository, read from the plugin and the
// type in its address.
function repositoryPulpType(row: { pulp_href: string }): string {
  const kind = /\/repositories\/([^/]+)\/([^/]+)\//.exec(row.pulp_href);
  if (!kind) {
    return '';
  }
  const [, app, type] = kind;

  return app === 'deb' ? 'deb.deb' : `${app}.${type}`;
}

// The publications of every plugin through the one list that holds them all:
// the `pulp_href__in` and `repository` filters, the ordering, the `fields` cut
// and the paging of listOf. The query of every request is recorded, in order.
export function corePublicationListHandler<T extends { pulp_href: string }>(
  rows: T[],
  { pageSize = 1000 }: { pageSize?: number } = {},
) {
  const path = '/pulp/api/v3/publications/';
  const list = listOf(path, rows, {
    pageSize,
    matching: (row, query) => {
      const hrefs = inSetOf(query, 'pulp_href__in');
      const repository = query.get('repository');
      return (
        (hrefs === null || hrefs.includes(row.pulp_href)) &&
        (repository === null ||
          (row as { repository?: unknown }).repository === repository)
      );
    },
    ordered: orderedBy,
    projected: projectedBy,
  });

  return { ...list, path };
}

// The `pulp_type` the server gives a content guard, read from the kind in its
// address.
const GUARD_PULP_TYPES: Readonly<Record<string, string>> = {
  rbac: 'core.rbac',
  header: 'core.header',
  envvar_header: 'core.envvar_header',
  composite: 'core.composite',
  content_redirect: 'core.content_redirect',
  x509: 'certguard.x509',
  rhsm: 'certguard.rhsm',
};

function guardPulpType(row: { pulp_href: string }): string {
  const kind = /\/contentguards\/[^/]+\/([^/]+)\//.exec(row.pulp_href)?.[1];

  return (kind && GUARD_PULP_TYPES[kind]) || '';
}

// The content guards of every kind through the one list that holds them all:
// the `pulp_href__in`, `name__icontains` and `pulp_type__in` filters, the name
// ordering, the `fields` cut and the paging of listOf. The query of every
// request is recorded, in order.
export function contentGuardListHandler<
  T extends { pulp_href: string; name?: string },
>(rows: T[], { pageSize = 1000 }: { pageSize?: number } = {}) {
  const path = '/pulp/api/v3/contentguards/';
  const list = listOf(path, rows, {
    pageSize,
    matching: (row, query) => {
      const hrefs = inSetOf(query, 'pulp_href__in');
      const types = inSetOf(query, 'pulp_type__in');
      const text = query.get('name__icontains');

      return (
        (hrefs === null || hrefs.includes(row.pulp_href)) &&
        (types === null || types.includes(guardPulpType(row))) &&
        (text === null ||
          (row.name ?? '').toLowerCase().includes(text.toLowerCase()))
      );
    },
    ordered: orderedBy,
    projected: projectedBy,
  });

  return { ...list, path };
}

// The repository versions list as one of two servers answers it. A patched
// server selects exactly the versions named by `pulp_href__in` and cuts rows
// to `fields`. An unpatched server cannot read a version address as a filter
// value and answers 400 to any request that carries one. The query of every
// request is recorded, in order.
export function versionSummaryHandler<T extends { pulp_href: string }>({
  patched,
  versions,
}: {
  patched: boolean;
  versions: T[];
}) {
  const queries: URLSearchParams[] = [];
  const path = '/pulp/api/v3/repository_versions/';

  const handler = http.get(`*${path}`, ({ request }) => {
    const query = new URL(request.url).searchParams;
    queries.push(new URLSearchParams(query));
    const hrefs = inSetOf(query, 'pulp_href__in');
    if (!patched && hrefs !== null) {
      return HttpResponse.json(
        { pulp_href__in: ['Enter a valid UUID.'] },
        { status: 400 },
      );
    }
    const rows = versions.filter(
      (row) => hrefs === null || hrefs.includes(row.pulp_href),
    );
    return HttpResponse.json(page(rows.map((row) => projectedBy(row, query))));
  });

  return { handler, queries, path };
}

// Compares two values of a column the way a database orders them: numbers by
// value, text by its characters.
const compareValues = (a: unknown, b: unknown) =>
  a === b ? 0 : (a as string) < (b as string) ? -1 : 1;

// Puts rows in the order of an `ordering` query: a comma separated list of
// columns, a leading minus sorting down. The first column decides, the next
// ones break a tie.
function orderedBy<T>(rows: T[], query: URLSearchParams): T[] {
  const columns = (query.get('ordering') ?? '').split(',').filter(Boolean);
  if (columns.length === 0) {
    return rows;
  }
  return [...rows].sort((a, b) => {
    for (const column of columns) {
      const down = column.startsWith('-');
      const key = down ? column.slice(1) : column;
      const order = compareValues(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      );
      if (order !== 0) {
        return down ? -order : order;
      }
    }
    return 0;
  });
}

type Labels = Record<string, string | null> | null | undefined;

// What a server does with a `pulp_label_select` value: it either refuses a term
// with the text the server gives, or selects the rows whose labels satisfy
// every term. Terms are split at commas that are not escaped; `key=value` needs
// that pair, `key!=value` needs the key with another value, `key~part` needs a
// value that contains the part, `key` needs the key and `!key` its absence.
export function labelSelectOf(
  select: string,
): { refusal: string } | { matches: (labels: Labels) => boolean } {
  const checks: ((labels: Labels) => boolean)[] = [];

  for (const term of select.split(/(?<!\\),/)) {
    const found = /^(!?[\w .-]+)(=|!=|~)?(.*)?/.exec(term);
    if (!found) {
      return { refusal: `Invalid search term: '${term}'.` };
    }
    const [, key = '', operator, raw = ''] = found;
    const value = raw.replace(/\\,/g, ',');
    if (key.startsWith('!') && operator) {
      return { refusal: `Cannot use an operator with '${key}'.` };
    }
    const has = (labels: Labels, name: string) =>
      Object.prototype.hasOwnProperty.call(labels ?? {}, name);
    const valueOf = (labels: Labels, name: string) =>
      (labels ?? {})[name] ?? null;

    if (operator === '=') {
      checks.push(
        (labels) => has(labels, key) && valueOf(labels, key) === value,
      );
    } else if (operator === '!=') {
      checks.push(
        (labels) => has(labels, key) && valueOf(labels, key) !== value,
      );
    } else if (operator === '~') {
      checks.push((labels) =>
        (valueOf(labels, key) ?? '')
          .toLowerCase()
          .includes(value.toLowerCase()),
      );
    } else if (key.startsWith('!')) {
      checks.push((labels) => !has(labels, key.slice(1)));
    } else {
      checks.push((labels) => has(labels, key));
    }
  }

  return { matches: (labels) => checks.every((check) => check(labels)) };
}

// The list of a plugin's repositories or remotes as a server answers it: the
// filters name (exact), name__icontains, name__in and pulp_href__in (an empty
// set matches nothing), pulp_label_select (an invalid term is a 400 with the
// server's text), remote (`null` for no remote), the ordering of a column, the
// `fields` cut and the paging of listOf. A row is cut to the fields the query
// names, so a screen that reads a field it did not ask for sees it missing, as
// it would on a real server.
// It serves the plugin's own list path, which is returned with the handler
// and the recorded queries.
export function pluginListHandler<
  T extends { name: string; pulp_href: string },
>(
  plugin: TestPlugin,
  kind: 'repository' | 'remote',
  rows: T[],
  { pageSize }: { pageSize?: number } = {},
) {
  const path = `/pulp/api/v3/${kind === 'repository' ? 'repositories' : 'remotes'}/${PLUGINS[plugin].segment}/`;
  const inSet = (query: URLSearchParams, key: string) =>
    query.has(key) ? (query.get(key) ?? '').split(',').filter(Boolean) : null;

  const list = listOf(path, rows, {
    pageSize,
    matching: (row, query) => {
      const name = query.get('name');
      const part = query.get('name__icontains');
      const names = inSet(query, 'name__in');
      const hrefs = inSet(query, 'pulp_href__in');
      const select = query.get('pulp_label_select');
      const selected = select === null ? null : labelSelectOf(select);
      const remote = query.get('remote');
      const rowRemote = (row as { remote?: string | null }).remote ?? null;
      return (
        (name === null || row.name === name) &&
        (part === null ||
          row.name.toLowerCase().includes(part.toLowerCase())) &&
        (names === null || names.includes(row.name)) &&
        (hrefs === null || hrefs.includes(row.pulp_href)) &&
        (selected === null ||
          ('matches' in selected &&
            selected.matches((row as { pulp_labels?: Labels }).pulp_labels))) &&
        (remote === null ||
          (remote === 'null' ? rowRemote === null : rowRemote === remote))
      );
    },
    refusing: (query) => {
      const select = query.get('pulp_label_select');
      const selected = select === null ? null : labelSelectOf(select);
      return selected && 'refusal' in selected ? [selected.refusal] : undefined;
    },
    ordered: orderedBy,
    projected: projectedBy,
  });

  return { ...list, path };
}

// The versions of one repository as its `versions/` list answers them: the
// `number` filter selects the version with that number and `ordering` sorts
// the rows. The query of every request is recorded, in order.
export function versionListHandler<
  T extends { pulp_href: string; number: number },
>(repository: { pulp_href: string }, versions: T[]) {
  const path = `${repository.pulp_href}versions/`;
  const list = listOf(path, versions, {
    matching: (row, query) => {
      const number = query.get('number');
      return number === null || String(row.number) === number;
    },
    ordered: orderedBy,
  });

  return { ...list, path };
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
  progress_reports: Record<string, unknown>[];
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

// The tasks list as the server answers it. The filters are `state`,
// `state__in`, `name`, `reserved_resources` and `reserved_resources__in`, the
// `ordering` of a column, the `fields` cut and the paging of listOf (a page
// holds at most pageSize rows, 1,000 as on the server). A reserved resource is
// held by a task when its record names it, exclusively or with the `shared:`
// prefix. As in the server, `reserved_resources__in` is NOT a set of
// alternatives: a task must hold every value, so a set of two repositories
// matches only a task that reserves both. `prns` maps the address of an object
// to its PRN, because the server turns an address into a PRN before it
// compares; a value that is not a key is compared as it is.
export function taskListHandler(
  rows: ITaskRow[],
  {
    pageSize = 1000,
    prns = {},
  }: { pageSize?: number; prns?: Record<string, string> } = {},
) {
  const path = '/pulp/api/v3/tasks/';
  const holds = (row: ITaskRow, value: string) => {
    const item = prns[value] ?? value;
    return row.reserved_resources_record.some(
      (entry) => entry === item || entry === `shared:${item}`,
    );
  };

  const list = listOf(path, rows, {
    pageSize,
    matching: (row, query) => {
      const state = query.get('state');
      const states = inSetOf(query, 'state__in');
      const name = query.get('name');
      const one = query.get('reserved_resources');
      const every = inSetOf(query, 'reserved_resources__in');
      return (
        (state === null || row.state === state) &&
        (states === null || states.includes(row.state)) &&
        (name === null || row.name === name) &&
        (one === null || holds(row, one)) &&
        (every === null || every.every((value) => holds(row, value)))
      );
    },
    ordered: orderedBy,
    projected: projectedBy,
  });

  return { ...list, path };
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
  // an id given by the test names the group's address too, as on the server
  const fresh = bump();
  const id = overrides.id ?? fresh;
  return {
    pulp_href: `/pulp/api/v3/groups/${id}/`,
    id,
    name: `group-${id}`,
    ...overrides,
  };
}

// A group as the group list reads it: the address is relative and every field
// the server lists is present.
export function groupRow(overrides: Partial<IGroup> = {}): IGroup {
  return group(overrides);
}

// One page of a group list answer.
export function groupPage(
  rows: IGroup[],
  options: { count?: number; next?: string } = {},
): IPage<IGroup> {
  return page(rows, options);
}

// A group as a user's own answer lists it: by name and address, with no
// numeric id.
export interface IUserGroup {
  pulp_href: string;
  prn: string;
  name: string;
}

export function userGroup(id: number, name = `group-${id}`): IUserGroup {
  return {
    pulp_href: `/pulp/api/v3/groups/${id}/`,
    prn: `prn:auth.group:${id}`,
    name,
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
  groups: (IGroup | IUserGroup)[];
  [field: string]: unknown;
}

// A user as the server returns it, with no group and a blank name.
export function user(overrides: Partial<IUser> = {}): IUser {
  // an id given by the test names the user's address too, as on the server
  const fresh = bump();
  const id = overrides.id ?? fresh;
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

// A user as the user list and the user screens read it: the address is
// relative and every field the server lists is present.
export function userRow(overrides: Partial<IUser> = {}): IUser {
  return user(overrides);
}

// One page of a user list answer.
export function userPage(
  rows: IUser[],
  options: { count?: number; next?: string } = {},
): IPage<IUser> {
  return page(rows, options);
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

export interface IRoleAssignment {
  role: string;
  content_object: string | null;
  [field: string]: unknown;
}

// A role held by a user or a group, as the roles of a user or a group list it:
// the role's name and the object it is held on (null for every object of its
// kind). Further fields of the server's answer can be added through
// `overrides`; a read that asks for `fields` cuts them again.
export function roleAssignment(
  roleName: string,
  contentObject: string | null,
  overrides: Record<string, unknown> = {},
): IRoleAssignment {
  return {
    pulp_href: href('users/1/roles'),
    role: roleName,
    content_object: contentObject,
    content_object_prn: null,
    permissions: [],
    pulp_created: '2000-01-01T00:00:00.000000Z',
    description: '',
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

// What an upload lab saw of one content create: the text fields of the
// multipart body and the size of the file it carried, if any.
export interface LabCreate {
  fields: Record<string, string>;
  fileBytes: number | null;
}

// What an upload lab saw of one chunk of a chunked upload.
export interface LabChunk {
  upload: string;
  range: string | null;
  bytes: number;
}

export interface UploadLabOptions {
  // The address content creates are posted to.
  contentPath?: string;
  // How long a chunk request stays in flight, so overlapping chunks are seen.
  chunkMs?: number;
  // A chunk the server refuses at once with a 400, chosen by its first byte.
  refuseChunk?: (start: number) => string | undefined;
  // A content create the server refuses with a 400, chosen by its fields.
  refuseCreate?: (create: LabCreate) => string | undefined;
  // A content create whose task fails, chosen by its fields.
  failTask?: (create: LabCreate) => string | undefined;
  // How long a content create waits before it answers.
  createMs?: number;
}

// The upload endpoints of a server, the content create of one plugin, the
// tasks the creates start and the modify of any repository, for a test to pass
// to server.use. Everything the server saw is recorded in the order it came in
// `events`, and in more detail in the other lists. A content create answers
// with a task that is already completed and names the new content (and, when
// the create named a repository, the new repository version too, as the server
// does).
export function uploadLab({
  contentPath = '/pulp/api/v3/content/file/files/',
  chunkMs = 0,
  refuseChunk,
  refuseCreate,
  failTask,
  createMs = 0,
}: UploadLabOptions = {}) {
  const events: string[] = [];
  const uploads: { href: string; size: number }[] = [];
  const chunks: LabChunk[] = [];
  const creates: LabCreate[] = [];
  const removed: string[] = [];
  const modifies: { href: string; body: unknown }[] = [];
  const tasks = new Map<string, ITaskRow>();
  const state = {
    inFlight: 0,
    maxInFlight: 0,
    createsInFlight: 0,
    maxCreates: 0,
  };

  const startTask = (overrides: Partial<ITaskRow>) => {
    const row = taskRow(overrides);
    tasks.set(row.pulp_href, row);
    return row;
  };

  const handlers = [
    http.post('*/pulp/api/v3/uploads/', async ({ request }) => {
      const body = (await request.json()) as { size: number };
      const upload = href('uploads');
      uploads.push({ href: upload, size: body.size });
      events.push('upload-create');
      return HttpResponse.json({ pulp_href: upload }, { status: 201 });
    }),
    http.put('*/pulp/api/v3/uploads/:id/', async ({ request }) => {
      const range = request.headers.get('Content-Range');
      const form = await request.formData();
      const part = form.get('file');
      const bytes = part instanceof Blob ? part.size : 0;
      chunks.push({ upload: new URL(request.url).pathname, range, bytes });
      events.push(`chunk ${range}`);
      const start = Number(/bytes (\d+)-/.exec(range ?? '')?.[1] ?? 0);
      const refusal = refuseChunk?.(start);
      if (refusal !== undefined) {
        return HttpResponse.json({ detail: refusal }, { status: 400 });
      }
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      if (chunkMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, chunkMs));
      }
      state.inFlight -= 1;
      return HttpResponse.json(
        { pulp_href: new URL(request.url).pathname },
        { status: 200 },
      );
    }),
    http.delete('*/pulp/api/v3/uploads/:id/', ({ request }) => {
      removed.push(new URL(request.url).pathname);
      events.push('upload-delete');
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(`*${contentPath}`, async ({ request }) => {
      const form = await request.formData();
      const fields: Record<string, string> = {};
      let fileBytes: number | null = null;
      form.forEach((value, name) => {
        if (value instanceof Blob) {
          fileBytes = value.size;
        } else {
          fields[name] = String(value);
        }
      });
      const create: LabCreate = { fields, fileBytes };
      creates.push(create);
      events.push(`content-create ${fields['relative_path'] ?? '(no path)'}`);
      state.createsInFlight += 1;
      state.maxCreates = Math.max(state.maxCreates, state.createsInFlight);
      if (createMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, createMs));
      }
      state.createsInFlight -= 1;
      const refusal = refuseCreate?.(create);
      if (refusal !== undefined) {
        return HttpResponse.json({ detail: refusal }, { status: 400 });
      }
      const failure = failTask?.(create);
      const content = href(
        contentPath.replace(/^\/pulp\/api\/v3\//, '').replace(/\/$/, ''),
      );
      const row = startTask(
        failure === undefined
          ? {
              created_resources: [
                content,
                ...(fields['repository']
                  ? [`${fields['repository']}versions/1/`]
                  : []),
              ],
            }
          : { state: 'failed', error: { description: failure } },
      );
      return HttpResponse.json({ task: row.pulp_href }, { status: 202 });
    }),
    http.post('*/modify/', async ({ request }) => {
      const url = new URL(request.url).pathname;
      modifies.push({ href: url, body: await request.json() });
      events.push('modify');
      const row = startTask({ created_resources: [`${url}versions/9/`] });
      return HttpResponse.json({ task: row.pulp_href }, { status: 202 });
    }),
    http.get('*/pulp/api/v3/tasks/:id/', ({ request }) => {
      const row = tasks.get(new URL(request.url).pathname);
      return row
        ? HttpResponse.json(row)
        : HttpResponse.json({ detail: 'Not found.' }, { status: 404 });
    }),
  ];

  return {
    handlers,
    events,
    uploads,
    chunks,
    creates,
    removed,
    modifies,
    state,
  };
}
