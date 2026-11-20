import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError } from 'src/entities/response-shape';
import {
  listOf,
  page,
  repository,
  repositoryVersion,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { fileRepository } from './repository';

const COLLECTION = '/pulp/api/v3/repositories/file/file/';
const LIST = `*${COLLECTION}`;
const TASK = '/pulp/api/v3/tasks/00000000-0000-4000-8000-00000000f001/';

// The body and the query of every request a handler answers, for assertions.
function recorder() {
  const seen: { method: string; url: URL; body: unknown }[] = [];
  return {
    seen,
    async record(request: Request) {
      const text = await request.clone().text();
      seen.push({
        method: request.method,
        url: new URL(request.url),
        body: text ? JSON.parse(text) : undefined,
      });
    },
  };
}

describe('Unit: the file repository entity', { tags: ['unit'] }, () => {
  it('names the plugin and the object it keys its reads by', () => {
    expect(fileRepository.app).toBe('file');
    expect(fileRepository.object).toBe('repository');
  });

  describe('list', () => {
    it('maps page, size, sort and filters to what the server takes', async () => {
      const rows = listOf(COLLECTION, [repository({ name: 'a' })]);
      server.use(rows.handler);

      await fileRepository.list({
        page: 3,
        page_size: 20,
        sort: '-name',
        name__icontains: 'ops',
        pulp_label_select: 'team=ops',
        pulp_href__in: ['/pulp/api/v3/repositories/file/file/x/'],
      });

      expect(Object.fromEntries(rows.queries[0])).toEqual({
        offset: '40',
        limit: '20',
        ordering: '-name',
        name__icontains: 'ops',
        pulp_label_select: 'team=ops',
        pulp_href__in: '/pulp/api/v3/repositories/file/file/x/',
      });
    });

    it('asks for the first page of the default size and sends no filter that is not set', async () => {
      const rows = listOf(COLLECTION, [repository()]);
      server.use(rows.handler);

      await fileRepository.list({ name__icontains: '', pulp_label_select: '' });

      expect(Object.fromEntries(rows.queries[0])).toEqual({
        offset: '0',
        limit: '50',
      });
    });

    it('falls back to the first page for a page number that is not one', async () => {
      const rows = listOf(COLLECTION, [repository()]);
      server.use(rows.handler);

      await fileRepository.list({ page: Number.NaN, page_size: -4 });

      expect(rows.queries[0].get('offset')).toBe('0');
      expect(rows.queries[0].get('limit')).toBe('50');
    });

    it('keeps the fields of an answer that the model does not name', async () => {
      server.use(
        listOf(COLLECTION, [
          repository({ name: 'a', brand_new_field: { deep: 1 } }),
        ]).handler,
      );

      const answer = await fileRepository.list({});

      expect(answer.results[0]).toMatchObject({
        name: 'a',
        brand_new_field: { deep: 1 },
      });
    });

    it('answers an empty page and sends nothing for an empty set of addresses', async () => {
      const rows = listOf(COLLECTION, [repository()]);
      server.use(rows.handler);

      const answer = await fileRepository.list({ pulp_href__in: [] });

      expect(answer).toMatchObject({ count: 0, results: [] });
      expect(rows.queries).toHaveLength(0);
    });

    it('refuses a row whose address leads away from the server', async () => {
      server.use(
        listOf(COLLECTION, [
          repository({ pulp_href: 'https://other.example/x/' }),
        ]).handler,
      );

      await expect(fileRepository.list({})).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });

    it('refuses a row that has no name', async () => {
      const row: Record<string, unknown> = repository();
      delete row.name;
      server.use(listOf(COLLECTION, [row]).handler);

      await expect(fileRepository.list({})).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });
  });

  describe('urlOf', () => {
    it('is the address a list of the same parameters is requested from', async () => {
      const rows = listOf(COLLECTION, [repository()]);
      server.use(rows.handler);
      const params = { name__in: ['a b', 'c/d'], page_size: 5 };

      const url = fileRepository.urlOf(params);
      await fileRepository.list(params);

      const requested = new URLSearchParams(url.split('?')[1]);
      expect(Object.fromEntries(requested)).toEqual(
        Object.fromEntries(rows.queries[0]),
      );
      expect(url).toContain('repositories/file/file/?');
    });
  });

  describe('byName', () => {
    it('sends the exact name filter and a limit of one, and returns the row', async () => {
      const row = repository({ name: 'a b' });
      const rows = listOf(COLLECTION, [row], {
        matching: (r, query) => r.name === query.get('name'),
      });
      server.use(rows.handler);

      const found = await fileRepository.byName('a b');

      expect(found).toMatchObject({ name: 'a b', pulp_href: row.pulp_href });
      expect(rows.queries).toHaveLength(1);
      expect(Object.fromEntries(rows.queries[0])).toEqual({
        name: 'a b',
        limit: '1',
      });
    });

    it('returns null for an empty page', async () => {
      server.use(
        listOf(COLLECTION, [repository({ name: 'other' })], {
          matching: (r, query) => r.name === query.get('name'),
        }).handler,
      );

      expect(await fileRepository.byName('missing')).toBeNull();
    });

    it('returns null for a row that is not the name asked for', async () => {
      // a server that ignored the filter would answer its first repository
      server.use(listOf(COLLECTION, [repository({ name: 'first' })]).handler);

      expect(await fileRepository.byName('second')).toBeNull();
    });

    it('sends no request for an empty name, which a server reads as no filter', async () => {
      const rows = listOf(COLLECTION, [repository({ name: 'first' })]);
      server.use(rows.handler);

      expect(await fileRepository.byName('')).toBeNull();
      expect(rows.queries).toHaveLength(0);
    });

    it('carries a name only as the value of the name filter, never in a path', async () => {
      const paths: string[] = [];
      const names: (string | null)[] = [];
      server.use(
        http.get(LIST, ({ request }) => {
          const url = new URL(request.url);
          paths.push(url.pathname);
          names.push(url.searchParams.get('name'));
          return HttpResponse.json(page([]));
        }),
      );

      const hostile = '../../status/?limit=1000&name=x#frag';
      await fileRepository.byName(hostile);

      expect(paths).toEqual([COLLECTION]);
      expect(names).toEqual([hostile]);
    });
  });

  describe('retrieve', () => {
    it('reads a repository by its address and parses it', async () => {
      const row = repository({ name: 'a', autopublish: true });
      server.use(http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)));

      expect(await fileRepository.retrieve(row.pulp_href)).toMatchObject({
        name: 'a',
        autopublish: true,
      });
    });

    it('refuses an answer without a name', async () => {
      const row = repository();
      server.use(
        http.get(`*${row.pulp_href}`, () =>
          HttpResponse.json({ pulp_href: row.pulp_href }),
        ),
      );

      await expect(
        fileRepository.retrieve(row.pulp_href),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });

  describe('writes', () => {
    it('creates a repository with one POST of the given fields', async () => {
      const calls = recorder();
      server.use(
        http.post(LIST, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json(repository({ name: 'new' }), {
            status: 201,
          });
        }),
      );

      const created = await fileRepository.create({
        name: 'new',
        autopublish: true,
        pulp_labels: { team: 'ops' },
      });

      expect(created.name).toBe('new');
      expect(calls.seen).toHaveLength(1);
      expect(calls.seen[0].body).toEqual({
        name: 'new',
        autopublish: true,
        pulp_labels: { team: 'ops' },
      });
    });

    it('updates with one PATCH of the given fields only and tells a started task', async () => {
      const row = repository();
      const calls = recorder();
      server.use(
        http.patch(`*${row.pulp_href}`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
      );

      const result = await fileRepository.update(row.pulp_href, {
        description: 'd',
      });

      expect(result).toEqual({ kind: 'task', task: TASK });
      expect(calls.seen).toHaveLength(1);
      expect(calls.seen[0].body).toEqual({ description: 'd' });
    });

    it('tells an update the server finished at once', async () => {
      const row = repository({ description: 'd' });
      server.use(http.patch(`*${row.pulp_href}`, () => HttpResponse.json(row)));

      const result = await fileRepository.update(row.pulp_href, {
        description: 'd',
      });

      expect(result).toMatchObject({
        kind: 'done',
        repository: { name: row.name },
      });
    });

    it('returns the task a delete starts', async () => {
      const row = repository();
      server.use(
        http.delete(`*${row.pulp_href}`, () =>
          HttpResponse.json({ task: TASK }, { status: 202 }),
        ),
      );

      expect(await fileRepository.remove(row.pulp_href)).toBe(TASK);
    });

    it('refuses a task address that leads away from the server', async () => {
      const row = repository();
      server.use(
        http.delete(`*${row.pulp_href}`, () =>
          HttpResponse.json(
            { task: 'https://other.example/tasks/1/' },
            { status: 202 },
          ),
        ),
      );

      await expect(fileRepository.remove(row.pulp_href)).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });

    it('sets and unsets a label with one POST each', async () => {
      const row = repository();
      const calls = recorder();
      server.use(
        http.post(`*${row.pulp_href}set_label/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ key: 'team', value: 'ops' });
        }),
        http.post(`*${row.pulp_href}unset_label/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ key: 'team', value: 'ops' });
        }),
      );

      await fileRepository.setLabel(row.pulp_href, {
        key: 'team',
        value: 'ops',
      });
      await fileRepository.unsetLabel(row.pulp_href, 'team');

      expect(calls.seen.map((call) => call.method)).toEqual(['POST', 'POST']);
      expect(calls.seen.map((call) => call.url.pathname)).toEqual([
        `${row.pulp_href}set_label/`,
        `${row.pulp_href}unset_label/`,
      ]);
      expect(calls.seen.map((call) => call.body)).toEqual([
        { key: 'team', value: 'ops' },
        { key: 'team' },
      ]);
    });

    it('starts a sync and a modify and returns their tasks', async () => {
      const row = repository();
      const calls = recorder();
      server.use(
        http.post(`*${row.pulp_href}sync/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
        http.post(`*${row.pulp_href}modify/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
      );

      expect(await fileRepository.sync?.(row.pulp_href, { mirror: true })).toBe(
        TASK,
      );
      expect(
        await fileRepository.modify?.(row.pulp_href, {
          base_version: `${row.pulp_href}versions/1/`,
        }),
      ).toBe(TASK);
      expect(calls.seen.map((call) => call.body)).toEqual([
        { mirror: true },
        { base_version: `${row.pulp_href}versions/1/` },
      ]);
    });
  });

  describe('versions', () => {
    it('lists the versions of a repository by page and sort', async () => {
      const row = repository();
      const versions = listOf(`${row.pulp_href}versions/`, [
        repositoryVersion(row, 2),
        repositoryVersion(row, 1),
      ]);
      server.use(versions.handler);

      const answer = await fileRepository.versions(row.pulp_href, {
        page: 2,
        page_size: 10,
        sort: '-number',
      });

      expect(Object.fromEntries(versions.queries[0])).toEqual({
        offset: '10',
        limit: '10',
        ordering: '-number',
      });
      expect(answer.results.map((version) => version.number)).toEqual([2, 1]);
    });

    it('reads one version by its address', async () => {
      const row = repository();
      const version = repositoryVersion(row, 3);
      server.use(
        http.get(`*${version.pulp_href}`, () => HttpResponse.json(version)),
      );

      expect(await fileRepository.version(version.pulp_href)).toMatchObject({
        number: 3,
        repository: row.pulp_href,
      });
    });

    it('refuses a version without a number', async () => {
      const row = repository();
      const version = repositoryVersion(row, 3);
      server.use(
        http.get(`*${version.pulp_href}`, () =>
          HttpResponse.json({ pulp_href: version.pulp_href }),
        ),
      );

      await expect(
        fileRepository.version(version.pulp_href),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });
});
