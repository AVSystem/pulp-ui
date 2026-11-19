import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError, parseResponse } from 'src/entities/response-shape';
import { server } from 'src/test-utils/server';
import { GroupClient } from './client';
import { groupHref, groupUrlId } from './href';
import { groupMemberPageSchema, groupPageSchema, groupSchema } from './model';
import { groupKeys } from './queries';

const GROUPS = '*/pulp/api/v3/groups/';
const row = (over: Record<string, unknown> = {}) => ({
  pulp_href: '/pulp/api/v3/groups/3/',
  id: 3,
  name: 'ops',
  ...over,
});

describe('group model', { tags: ['unit'] }, () => {
  it('parses a page and keeps a field it does not name', () => {
    const parsed = parseResponse(groupPageSchema, {
      count: 1,
      next: null,
      previous: null,
      results: [row({ brand_new_field: 1 })],
    });

    expect(parsed.results[0]).toMatchObject({
      name: 'ops',
      brand_new_field: 1,
    });
  });

  it('refuses a row without a name, an id or an address of this host', () => {
    const without = (field: string) => {
      const copy: Record<string, unknown> = row();
      delete copy[field];
      return copy;
    };

    expect(() => parseResponse(groupSchema, without('name'))).toThrow(
      ResponseShapeError,
    );
    expect(() => parseResponse(groupSchema, without('id'))).toThrow(
      ResponseShapeError,
    );
    expect(() =>
      parseResponse(
        groupSchema,
        row({ pulp_href: 'https://other.example/g/' }),
      ),
    ).toThrow(ResponseShapeError);
  });
});

describe('group client', { tags: ['unit'] }, () => {
  function serveGroups() {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(GROUPS, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [row()],
        });
      }),
    );
    return queries;
  }

  it('asks for the page, its size and the name filter that is set', async () => {
    const queries = serveGroups();

    await GroupClient.list({ page: 2, page_size: 5, name__contains: 'op' });

    expect(Object.fromEntries(queries[0])).toEqual({
      offset: '5',
      limit: '5',
      name__contains: 'op',
    });
  });

  it('sends no name filter when it is empty', async () => {
    const queries = serveGroups();

    await GroupClient.list({ name__contains: '', page_size: 5 });

    expect(queries[0].has('name__contains')).toBe(false);
  });
});

describe('group keys', { tags: ['unit'] }, () => {
  it('start with the app and the object and differ by their parameters', () => {
    expect(groupKeys.list({ page_size: 5 }).slice(0, 3)).toEqual([
      'pulp',
      'core',
      'group',
    ]);
    expect(groupKeys.list({ name__contains: 'a' })).not.toEqual(
      groupKeys.list({ name__contains: 'ab' }),
    );
    expect(groupKeys.members('/pulp/api/v3/groups/3/', 10).slice(0, 3)).toEqual(
      ['pulp', 'core', 'group'],
    );
  });
});

describe('group addresses', { tags: ['unit'] }, () => {
  it('turns the id of an address into the address of the group and back', () => {
    expect(groupUrlId('/pulp/api/v3/groups/3/')).toBe('3');
    expect(groupHref('3')).toMatch(/groups\/3\/$/);
    expect(groupUrlId(groupHref('12'))).toBe('12');
  });

  it('refuses an id that is not a positive whole number', () => {
    for (const bad of ['', '0', '-1', '1.5', '3/', 'abc', '../users/1', null]) {
      expect(groupHref(bad)).toBeNull();
    }
    expect(groupHref(undefined)).toBeNull();
  });

  it('names no id for an address of anything else', () => {
    expect(groupUrlId('/pulp/api/v3/users/3/')).toBeNull();
    expect(groupUrlId('/pulp/api/v3/groups/3/users/')).toBeNull();
    expect(groupUrlId(null)).toBeNull();
    expect(groupUrlId(undefined)).toBeNull();
  });
});

describe(
  'group client writes and reads of one group',
  { tags: ['unit'] },
  () => {
    it('asks for the order and the name filter of the list', async () => {
      const queries: URLSearchParams[] = [];
      server.use(
        http.get(GROUPS, ({ request }) => {
          queries.push(new URL(request.url).searchParams);
          return HttpResponse.json({
            count: 0,
            next: null,
            previous: null,
            results: [],
          });
        }),
      );

      await GroupClient.list({ sort: '-name', name__icontains: 'Op' });
      await GroupClient.list({ sort: '', name__icontains: '' });

      expect(Object.fromEntries(queries[0])).toMatchObject({
        ordering: '-name',
        name__icontains: 'Op',
      });
      expect(queries[1].has('ordering')).toBe(false);
      expect(queries[1].has('name__icontains')).toBe(false);
    });

    it('reads one group by its address', async () => {
      server.use(
        http.get('*/pulp/api/v3/groups/3/', () => HttpResponse.json(row())),
      );

      await expect(
        GroupClient.retrieve('/pulp/api/v3/groups/3/'),
      ).resolves.toMatchObject({ id: 3, name: 'ops' });
    });

    it('creates a group with one POST of the name', async () => {
      const bodies: unknown[] = [];
      server.use(
        http.post(GROUPS, async ({ request }) => {
          bodies.push(await request.json());
          return HttpResponse.json(row({ name: 'new' }), { status: 201 });
        }),
      );

      const created = await GroupClient.create({ name: 'new' });

      expect(bodies).toEqual([{ name: 'new' }]);
      expect(created.pulp_href).toBe('/pulp/api/v3/groups/3/');
    });

    it('deletes a group with one DELETE to its address', async () => {
      const paths: string[] = [];
      server.use(
        http.delete('*/pulp/api/v3/groups/3/', ({ request }) => {
          paths.push(new URL(request.url).pathname);
          return new HttpResponse(null, { status: 204 });
        }),
      );

      await GroupClient.remove('/pulp/api/v3/groups/3/');

      expect(paths).toEqual(['/pulp/api/v3/groups/3/']);
    });
  },
);

describe('group members', { tags: ['unit'] }, () => {
  it('parses the usernames and keeps a field it does not name', () => {
    const parsed = parseResponse(groupMemberPageSchema, {
      count: 1,
      next: null,
      previous: null,
      results: [{ username: 'ann', prn: 'x', new_field: 1 }],
    });

    expect(parsed.results[0]).toMatchObject({ username: 'ann', new_field: 1 });
  });

  it('asks the group for its own members, never the list of all users', async () => {
    const seen: { path: string; query: URLSearchParams }[] = [];
    server.use(
      http.get('*/pulp/api/v3/groups/3/users/', ({ request }) => {
        const url = new URL(request.url);
        seen.push({ path: url.pathname, query: url.searchParams });
        return HttpResponse.json({
          count: 12,
          next: null,
          previous: null,
          results: [{ username: 'ann' }],
        });
      }),
    );

    const members = await GroupClient.members('/pulp/api/v3/groups/3/', {
      limit: 10,
    });

    expect(members.count).toBe(12);
    expect(seen).toHaveLength(1);
    expect(seen[0].path).toBe('/pulp/api/v3/groups/3/users/');
    expect(seen[0].query.get('limit')).toBe('10');
  });
});
