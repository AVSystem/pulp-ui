import { describe, expect, it } from 'vitest';
import {
  distribution,
  listOf,
  page,
  pluginListHandler,
  pluginRemote,
  pluginRepository,
  publication,
  remote,
  repository,
} from './pulp';
import { server } from './server';

const REPOSITORIES = '/pulp/api/v3/repositories/file/file/';

describe('page', () => {
  it('defaults count to the number of results and leaves the links empty', () => {
    expect(page(['a', 'b'])).toStrictEqual({
      count: 2,
      next: null,
      previous: null,
      results: ['a', 'b'],
    });
  });

  it('takes count and next from the options', () => {
    const body = page(['a'], {
      count: 7,
      next: 'https://pulp.example/next/',
    });

    expect(body.count).toBe(7);
    expect(body.next).toBe('https://pulp.example/next/');
  });
});

describe('listOf', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'];

  async function read(query: string) {
    const response = await fetch(`${REPOSITORIES}?${query}`);
    return response.json();
  }

  it('answers an offset and limit request with that slice and the total count', async () => {
    const { handler } = listOf(REPOSITORIES, rows);
    server.use(handler);

    const body = await read('offset=1&limit=2');

    expect(body.results).toStrictEqual(['b', 'c']);
    expect(body.count).toBe(5);
  });

  it('answers only the rows the matching filter selects, with their count', async () => {
    const { handler } = listOf(REPOSITORIES, rows, {
      matching: (row, query) => row === query.get('name'),
    });
    server.use(handler);

    const body = await read('name=c');

    expect(body.results).toStrictEqual(['c']);
    expect(body.count).toBe(1);
  });

  it('links to the next page until the last page, which has none', async () => {
    const { handler } = listOf(REPOSITORIES, rows, { pageSize: 2 });
    server.use(handler);

    const first = await read('limit=500');
    const second = await (await fetch(first.next)).json();
    const third = await (await fetch(second.next)).json();

    expect(first.results).toStrictEqual(['a', 'b']);
    expect(second.results).toStrictEqual(['c', 'd']);
    expect(second.previous).not.toBeNull();
    expect(third.results).toStrictEqual(['e']);
    expect(third.next).toBeNull();
  });

  it('records the query of every request it answers', async () => {
    const { handler, queries } = listOf(REPOSITORIES, rows);
    server.use(handler);

    await read('limit=2&name__icontains=x');
    await read('offset=2');

    expect(queries.map((query) => query.get('name__icontains'))).toStrictEqual([
      'x',
      null,
    ]);
    expect(queries[1]?.get('offset')).toBe('2');
  });
});

describe('builders', () => {
  it('repository carries the fields the pages read and takes overrides', () => {
    const built = repository({ name: 'docs' });

    expect(built.name).toBe('docs');
    expect(built.pulp_href).toMatch(/^\/pulp\/api\/v3\/repositories\//);
    expect(built).toHaveProperty('latest_version_href');
  });

  it('distribution points at reserved hosts and carries its bindings', () => {
    const built = distribution({ base_path: 'docs', content_guard: '/guard/' });

    expect(built.base_url).toBe('https://pulp.example/pulp/content/docs/');
    expect(built.content_guard).toBe('/guard/');
    expect(built).toHaveProperty('repository');
    expect(built).toHaveProperty('publication');
    expect(built.name).toBeTruthy();
  });

  it('publication carries its repository version and a distinct href per call', () => {
    const first = publication({ repository_version: '/v/1/' });
    const second = publication();

    expect(first.repository_version).toBe('/v/1/');
    expect(first.pulp_href).not.toBe(second.pulp_href);
  });

  it('remote carries its url and policy and takes overrides', () => {
    const built = remote({ name: 'index', policy: 'streamed' });

    expect(built.name).toBe('index');
    expect(built.policy).toBe('streamed');
    expect(built.url).toBe('https://pulp.example/index/');
    expect(built.pulp_href).toMatch(/^\/pulp\/api\/v3\/remotes\//);
  });
});

describe('plugin builders', { tags: ['unit'] }, () => {
  it.each([
    ['file', 'file/file', 'file.filerepository'],
    ['deb', 'deb/apt', 'deb.aptrepository'],
    ['rpm', 'rpm/rpm', 'rpm.rpmrepository'],
    ['python', 'python/python', 'python.pythonrepository'],
  ] as const)(
    'pluginRepository(%s) has the address and the PRN of that plugin',
    (plugin, segment, model) => {
      const built = pluginRepository(plugin, { name: 'docs' });
      const id = built.pulp_href.split('/').filter(Boolean).pop();

      expect(built.name).toBe('docs');
      expect(built.pulp_href).toMatch(
        new RegExp(`^/pulp/api/v3/repositories/${segment}/[0-9a-f-]{36}/$`),
      );
      expect(built.prn).toBe(`prn:${model}:${id}`);
      expect(built.versions_href).toBe(`${built.pulp_href}versions/`);
      expect(built.latest_version_href).toBe(`${built.pulp_href}versions/0/`);
      expect(built.pulp_labels).toEqual({});
      expect(built.remote).toBeNull();
    },
  );

  it.each([
    ['file', 'file/file', 'file.fileremote'],
    ['deb', 'deb/apt', 'deb.aptremote'],
    ['rpm', 'rpm/rpm', 'rpm.rpmremote'],
    ['python', 'python/python', 'python.pythonremote'],
  ] as const)(
    'pluginRemote(%s) has the address and the PRN of that plugin',
    (plugin, segment, model) => {
      const built = pluginRemote(plugin, { name: 'index' });
      const id = built.pulp_href.split('/').filter(Boolean).pop();

      expect(built.name).toBe('index');
      expect(built.pulp_href).toMatch(
        new RegExp(`^/pulp/api/v3/remotes/${segment}/[0-9a-f-]{36}/$`),
      );
      expect(built.prn).toBe(`prn:${model}:${id}`);
      expect(built.url).toBe('https://pulp.example/index/');
      expect(built.pulp_labels).toEqual({});
    },
  );

  it('give every object its own address and let an override win', () => {
    const first = pluginRepository('file');
    const second = pluginRepository('file', { remote: '/pulp/api/v3/r/' });

    expect(first.pulp_href).not.toBe(second.pulp_href);
    expect(second.remote).toBe('/pulp/api/v3/r/');
  });
});

describe('pluginListHandler', { tags: ['unit'] }, () => {
  const rows = [
    pluginRepository('file', { name: 'beta', pulp_created: '2001-01-01' }),
    pluginRepository('file', { name: 'Alpha', pulp_created: '2003-01-01' }),
    pluginRepository('file', { name: 'gamma', pulp_created: '2002-01-01' }),
    pluginRepository('file', { name: 'alphabet', pulp_created: '2000-01-01' }),
  ];

  async function read(query: string) {
    const { handler, queries } = pluginListHandler('file', 'repository', rows);
    server.use(handler);
    const response = await fetch(`${REPOSITORIES}?${query}`);
    return { body: await response.json(), queries };
  }

  const names = (body: { results: { name: string }[] }) =>
    body.results.map((row) => row.name);

  it('serves the list path of the plugin and the kind', async () => {
    const remotes = pluginListHandler('rpm', 'remote', []);
    server.use(remotes.handler);

    const response = await fetch('/pulp/api/v3/remotes/rpm/rpm/');

    expect(response.status).toBe(200);
    expect(remotes.path).toBe('/pulp/api/v3/remotes/rpm/rpm/');
  });

  it('filters by the exact name', async () => {
    expect(names((await read('name=beta')).body)).toEqual(['beta']);
    expect(names((await read('name=BETA')).body)).toEqual([]);
  });

  it('filters by a part of the name, ignoring case', async () => {
    const { body } = await read('name__icontains=ALPHA');

    expect(names(body)).toEqual(['Alpha', 'alphabet']);
    expect(body.count).toBe(2);
  });

  it('filters by a comma separated set of addresses, and an empty set matches nothing', async () => {
    const wanted = [rows[2].pulp_href, rows[0].pulp_href].join(',');

    expect(names((await read(`pulp_href__in=${wanted}`)).body)).toEqual([
      'beta',
      'gamma',
    ]);
    expect(names((await read('pulp_href__in=')).body)).toEqual([]);
  });

  it('orders by a column, a leading minus sorting down', async () => {
    expect(names((await read('ordering=name')).body)).toEqual([
      'Alpha',
      'alphabet',
      'beta',
      'gamma',
    ]);
    expect(names((await read('ordering=-pulp_created')).body)).toEqual([
      'Alpha',
      'gamma',
      'beta',
      'alphabet',
    ]);
  });

  it('pages after it has filtered and ordered', async () => {
    const { body } = await read('ordering=-name&offset=1&limit=2');

    expect(names(body)).toEqual(['beta', 'alphabet']);
    expect(body.count).toBe(4);
  });

  it('records the query of every request', async () => {
    const { queries } = await read('name=beta&limit=1');

    expect(queries).toHaveLength(1);
    expect(queries[0].get('name')).toBe('beta');
  });
});
