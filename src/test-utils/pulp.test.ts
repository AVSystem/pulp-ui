import { describe, expect, it } from 'vitest';
import { distribution, listOf, page, publication, repository } from './pulp';
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
});
