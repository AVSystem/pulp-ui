import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError, parseResponse } from 'src/entities/response-shape';
import { server } from 'src/test-utils/server';
import { GroupRoleClient } from './client';
import { groupRoleHref } from './href';
import { groupRolePageSchema, groupRoleSchema } from './model';
import { groupRoleKeys } from './queries';

const GROUP = '/pulp/api/v3/groups/7/';
const ROLES = `*${GROUP}roles/`;
const ROLE_PATH = `${GROUP}roles/0189-aa/`;

const row = (over: Record<string, unknown> = {}) => ({
  pulp_href: ROLE_PATH,
  role: 'galaxy.collection_admin',
  description: 'Manages collections',
  permissions: ['galaxy.change_namespace'],
  content_object: null,
  pulp_created: '2000-01-01T00:00:00Z',
  ...over,
});

describe('group role model', { tags: ['unit'] }, () => {
  it('parses a page and keeps a field it does not name', () => {
    const parsed = parseResponse(groupRolePageSchema, {
      count: 1,
      next: null,
      previous: null,
      results: [row({ brand_new_field: 1 })],
    });

    expect(parsed.results[0]).toMatchObject({
      role: 'galaxy.collection_admin',
      brand_new_field: 1,
    });
  });

  it('accepts a role the server sent without a description or permissions', () => {
    const parsed = parseResponse(
      groupRoleSchema,
      row({ description: undefined, permissions: undefined }),
    );

    expect(parsed.role).toBe('galaxy.collection_admin');
  });

  it('refuses a row without a role name or an address of this host', () => {
    const without = (field: string) => {
      const copy: Record<string, unknown> = row();
      delete copy[field];
      return copy;
    };

    expect(() => parseResponse(groupRoleSchema, without('role'))).toThrow(
      ResponseShapeError,
    );
    expect(() => parseResponse(groupRoleSchema, without('pulp_href'))).toThrow(
      ResponseShapeError,
    );
    expect(() =>
      parseResponse(
        groupRoleSchema,
        row({ pulp_href: 'https://other.example/r/' }),
      ),
    ).toThrow(ResponseShapeError);
  });
});

describe('group role address', { tags: ['unit'] }, () => {
  it('builds the endpoint of one role of the group', () => {
    expect(groupRoleHref(GROUP, ROLE_PATH)).toBe(ROLE_PATH);
    expect(groupRoleHref(GROUP, `${ROLE_PATH}?x=1`)).toBe(ROLE_PATH);
  });

  it('is null for a role of another group, or an address that is no group role', () => {
    expect(groupRoleHref(GROUP, '/pulp/api/v3/groups/8/roles/0189-aa/')).toBe(
      null,
    );
    expect(groupRoleHref(GROUP, '/pulp/api/v3/users/7/roles/0189-aa/')).toBe(
      null,
    );
    expect(groupRoleHref(GROUP, `${GROUP}users/3/`)).toBe(null);
    expect(groupRoleHref(GROUP, `${GROUP}roles/`)).toBe(null);
    expect(groupRoleHref(GROUP, null)).toBe(null);
    expect(groupRoleHref(null, ROLE_PATH)).toBe(null);
    expect(groupRoleHref('/pulp/api/v3/users/7/', ROLE_PATH)).toBe(null);
  });
});

describe('group role client', { tags: ['unit'] }, () => {
  function serveRoles() {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(ROLES, ({ request }) => {
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

  it('asks for the page, its size, the order and the name filter, for the roles that act on the whole model', async () => {
    const queries = serveRoles();

    await GroupRoleClient.list(GROUP, {
      page: 3,
      page_size: 20,
      sort: '-role',
      role__icontains: 'admin',
    });

    expect(Object.fromEntries(queries[0])).toEqual({
      offset: '40',
      limit: '20',
      ordering: '-role',
      role__icontains: 'admin',
      content_object: 'null',
    });
  });

  it('sends no filter that is not set and the first page when none is named', async () => {
    const queries = serveRoles();

    await GroupRoleClient.list(GROUP, { role__icontains: '' });

    expect(Object.fromEntries(queries[0])).toEqual({
      offset: '0',
      limit: '10',
      content_object: 'null',
    });
  });

  it('reads one page from the group named by the address', async () => {
    serveRoles();

    const page = await GroupRoleClient.list(GROUP, {});

    expect(page.count).toBe(1);
    expect(page.results[0].role).toBe('galaxy.collection_admin');
  });

  it('refuses an answer that is not a page of group roles', async () => {
    server.use(http.get(ROLES, () => HttpResponse.json({ results: 'no' })));

    await expect(GroupRoleClient.list(GROUP, {})).rejects.toThrow(
      ResponseShapeError,
    );
  });

  it('adds a role with one request for the whole model', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(ROLES, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(row(), { status: 201 });
      }),
    );

    await GroupRoleClient.add(GROUP, 'galaxy.collection_admin');

    expect(bodies).toEqual([
      { role: 'galaxy.collection_admin', content_object: null },
    ]);
  });

  it('removes a role with one DELETE to the endpoint of the role', async () => {
    const deleted: string[] = [];
    server.use(
      http.delete(`*${ROLE_PATH}`, ({ request }) => {
        deleted.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await GroupRoleClient.remove(GROUP, ROLE_PATH);

    expect(deleted).toEqual([ROLE_PATH]);
  });

  it('sends no request for a role that does not belong to the group', async () => {
    const seen: string[] = [];
    server.events.on('request:start', ({ request }) => {
      seen.push(`${request.method} ${new URL(request.url).pathname}`);
    });

    await expect(
      GroupRoleClient.remove(GROUP, '/pulp/api/v3/groups/8/roles/0189-aa/'),
    ).rejects.toThrow();
    await expect(GroupRoleClient.remove(GROUP, undefined)).rejects.toThrow();

    expect(seen).toEqual([]);
  });

  it('passes the failure of a refused removal on', async () => {
    server.use(
      http.delete(`*${ROLE_PATH}`, () =>
        HttpResponse.json({ detail: 'No.' }, { status: 403 }),
      ),
    );

    await expect(
      GroupRoleClient.remove(GROUP, ROLE_PATH),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('group role keys', { tags: ['unit'] }, () => {
  it('start with the app and the object, and name the group before the parameters', () => {
    expect(groupRoleKeys.list(GROUP, { page: 2 })).toEqual([
      'pulp',
      'core',
      'group-role',
      'list',
      GROUP,
      { page: 2 },
    ]);
    expect(groupRoleKeys.of(GROUP)).toEqual([
      'pulp',
      'core',
      'group-role',
      'list',
      GROUP,
    ]);
  });
});
