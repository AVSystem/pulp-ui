import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError, parseResponse } from 'src/entities/response-shape';
import { role as roleRow } from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { RoleClient } from './client';
import { roleHref, roleUrlId } from './href';
import { rolePageSchema, roleSchema } from './model';
import { roleKeys } from './queries';

const ROLES = '*/pulp/api/v3/roles/';
const ID = '0192e5a1-0000-7000-8000-0000000000aa';
const PATH = `/pulp/api/v3/roles/${ID}/`;

describe('role model', { tags: ['unit'] }, () => {
  it('parses a page and keeps a field it does not name', () => {
    const parsed = parseResponse(rolePageSchema, {
      count: 1,
      next: null,
      previous: null,
      results: [{ ...roleRow({ name: 'zz-ops' }), brand_new_field: 1 }],
    });

    expect(parsed.results[0]).toMatchObject({
      name: 'zz-ops',
      brand_new_field: 1,
    });
  });

  it('refuses a row without a name or an address of this host', () => {
    const noName: Record<string, unknown> = { ...roleRow() };
    delete noName['name'];

    expect(() => parseResponse(roleSchema, noName)).toThrow(ResponseShapeError);
    expect(() =>
      parseResponse(
        roleSchema,
        roleRow({ pulp_href: 'https://other.example/roles/x/' }),
      ),
    ).toThrow(ResponseShapeError);
  });
});

describe('role address', { tags: ['unit'] }, () => {
  it('takes the id out of the address of a role', () => {
    expect(roleUrlId(PATH)).toBe(ID);
    expect(roleUrlId(`/pulp/api/v3/roles/${ID}`)).toBe(ID);
    expect(roleUrlId(`${PATH}?x=1`)).toBe(ID);
  });

  it('gives no id for an address that is not the address of a role', () => {
    expect(roleUrlId(`/pulp/api/v3/users/${ID}/`)).toBeNull();
    expect(roleUrlId(`${PATH}model-permissions/`)).toBeNull();
    expect(roleUrlId('/pulp/api/v3/roles/not-an-id/')).toBeNull();
    expect(roleUrlId('/pulp/api/v3/roles/')).toBeNull();
    expect(roleUrlId(null)).toBeNull();
    expect(roleUrlId(undefined)).toBeNull();
  });

  it('makes the address of a role out of an id of the right form only', () => {
    expect(roleHref(ID)).toBe(PATH);
    expect(roleHref(ID.toUpperCase())).toMatch(/\/pulp\/api\/v3\/roles\//);
    expect(roleHref('x')).toBeNull();
    expect(roleHref(`${ID}/../../status`)).toBeNull();
    expect(roleHref('7')).toBeNull();
    expect(roleHref('')).toBeNull();
    expect(roleHref(null)).toBeNull();
    expect(roleHref(undefined)).toBeNull();
  });

  it('turns an id into an address and back', () => {
    expect(roleUrlId(roleHref(ID))).toBe(ID);
  });
});

describe('role client', { tags: ['unit'] }, () => {
  it('asks for the page, its size, the order, the name and the built-in filter that are set', async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(ROLES, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        });
      }),
    );

    await RoleClient.list({
      page: 3,
      page_size: 5,
      sort: '-name',
      name__icontains: 'ops',
      locked: false,
    });
    await RoleClient.list({});

    expect(Object.fromEntries(queries[0])).toEqual({
      offset: '10',
      limit: '5',
      ordering: '-name',
      name__icontains: 'ops',
      locked: 'false',
    });
    expect(Object.fromEntries(queries[1])).toEqual({
      offset: '0',
      limit: '10',
    });
  });

  it('reads one role by its address', async () => {
    server.use(
      http.get(`*${PATH}`, () =>
        HttpResponse.json(roleRow({ pulp_href: PATH, name: 'zz-ops' })),
      ),
    );

    const role = await RoleClient.retrieve(PATH);

    expect(role).toMatchObject({ pulp_href: PATH, name: 'zz-ops' });
  });

  it('sends one POST with the name, description and permissions', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(ROLES, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(roleRow({ pulp_href: PATH, name: 'zz-new' }), {
          status: 201,
        });
      }),
    );

    const created = await RoleClient.create({
      name: 'zz-new',
      description: 'a role',
      permissions: ['core.view_task'],
    });

    expect(created.name).toBe('zz-new');
    expect(bodies).toEqual([
      {
        name: 'zz-new',
        description: 'a role',
        permissions: ['core.view_task'],
      },
    ]);
  });

  it('sends one PATCH of the role to its address', async () => {
    const sent: { path: string; body: unknown }[] = [];
    server.use(
      http.patch(`*${PATH}`, async ({ request }) => {
        sent.push({
          path: new URL(request.url).pathname,
          body: await request.json(),
        });
        return HttpResponse.json(roleRow({ pulp_href: PATH, name: 'zz-ops' }));
      }),
    );

    await RoleClient.updatePermissions(PATH, {
      name: 'zz-ops',
      description: 'd',
      permissions: ['core.view_task'],
    });

    expect(sent).toEqual([
      {
        path: PATH,
        body: {
          name: 'zz-ops',
          description: 'd',
          permissions: ['core.view_task'],
        },
      },
    ]);
  });

  it('sends one DELETE to the address of the role', async () => {
    const deleted: string[] = [];
    server.use(
      http.delete(`*${PATH}`, ({ request }) => {
        deleted.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await RoleClient.remove(PATH);

    expect(deleted).toEqual([PATH]);
  });

  it('turns an answer in the wrong shape into a response shape error', async () => {
    server.use(http.get(`*${PATH}`, () => HttpResponse.json({ name: 'x' })));

    await expect(RoleClient.retrieve(PATH)).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });
});

describe('role keys', { tags: ['unit'] }, () => {
  it('start with the app and the object, and a list is keyed by its parameters', () => {
    expect(roleKeys.all).toEqual(['pulp', 'core', 'role']);
    expect(roleKeys.list({ page: 2 })).toEqual([
      'pulp',
      'core',
      'role',
      'list',
      { page: 2 },
    ]);
    expect(roleKeys.detail(PATH)).toEqual([
      'pulp',
      'core',
      'role',
      'detail',
      PATH,
    ]);
  });
});
