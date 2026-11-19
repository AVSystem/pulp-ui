import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError, parseResponse } from 'src/entities/response-shape';
import { group, userPage, userRow } from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { RemovalNotConfirmedError, UserClient } from './client';
import { userHref, userUrlId } from './href';
import { userPageSchema, userSchema } from './model';
import { userKeys } from './queries';

const USERS = '*/pulp/api/v3/users/';

describe('user model', { tags: ['unit'] }, () => {
  it('parses a page with relative hrefs and keeps fields it does not name', () => {
    const row = userRow({ username: 'zz-ann', groups: [group()] });
    const body = { ...userPage([row]), extra: 'kept' };

    const parsed = parseResponse(userPageSchema, body);

    expect(parsed.count).toBe(1);
    expect(parsed.results[0].pulp_href).toBe(row.pulp_href);
    expect(parsed.results[0].username).toBe('zz-ann');
    expect(parsed.results[0].groups).toHaveLength(1);
  });

  it('keeps a field a later server version adds', () => {
    const row = { ...userRow(), brand_new_field: { a: 1 } };

    expect(parseResponse(userSchema, row)).toMatchObject({
      brand_new_field: { a: 1 },
    });
  });

  it('refuses a row without pulp_href or username', () => {
    const noHref: Record<string, unknown> = userRow();
    delete noHref['pulp_href'];
    const noName: Record<string, unknown> = userRow();
    delete noName['username'];

    expect(() => parseResponse(userSchema, noHref)).toThrow(ResponseShapeError);
    expect(() => parseResponse(userSchema, noName)).toThrow(ResponseShapeError);
  });

  it('refuses a row whose pulp_href points to another host', () => {
    const row = userRow({
      pulp_href: 'https://other.example/pulp/api/v3/users/1/',
    });

    expect(() => parseResponse(userSchema, row)).toThrow(ResponseShapeError);
  });
});

describe('user address', { tags: ['unit'] }, () => {
  it('takes the id out of the address of a user', () => {
    expect(userUrlId('/pulp/api/v3/users/7/')).toBe('7');
    expect(userUrlId('/pulp/api/v3/users/7')).toBe('7');
    expect(userUrlId('/pulp/api/v3/users/7/?x=1')).toBe('7');
  });

  it('gives no id for an address that is not the address of a user', () => {
    expect(userUrlId('/pulp/api/v3/groups/7/')).toBeNull();
    expect(userUrlId('/pulp/api/v3/users/7/roles/')).toBeNull();
    expect(userUrlId('/pulp/api/v3/users/abc/')).toBeNull();
    expect(userUrlId('/pulp/api/v3/users/0/')).toBeNull();
    expect(userUrlId(null)).toBeNull();
    expect(userUrlId(undefined)).toBeNull();
  });

  it('makes the address of a user out of a positive whole number only', () => {
    expect(userHref('7')).toMatch(/\/pulp\/api\/v3\/users\/7\/$/);
    expect(userHref('x')).toBeNull();
    expect(userHref('7/../../status')).toBeNull();
    expect(userHref('-1')).toBeNull();
    expect(userHref('0')).toBeNull();
    expect(userHref('07')).toBeNull();
    expect(userHref('')).toBeNull();
    expect(userHref(null)).toBeNull();
  });

  it('turns an id into an address and back', () => {
    expect(userUrlId(userHref('42'))).toBe('42');
  });
});

describe('user keys', { tags: ['unit'] }, () => {
  it('start with the pulp, core, user path', () => {
    expect(userKeys.all).toEqual(['pulp', 'core', 'user']);
    expect(userKeys.list({ page: 2 }).slice(0, 3)).toEqual(userKeys.all);
    expect(userKeys.detail('/pulp/api/v3/users/7/').slice(0, 3)).toEqual(
      userKeys.all,
    );
  });
});

describe('Integration: UserClient', { tags: ['integration'] }, () => {
  it('lists the page the address asks for, as offset, limit and ordering', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(USERS, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json(userPage([userRow()]));
      }),
    );

    await UserClient.list({
      page: 3,
      page_size: 20,
      sort: '-date_joined',
      username__contains: 'an',
      first_name__contains: 'A',
      last_name__contains: 'B',
      email__contains: 'example',
    });

    expect(Object.fromEntries(seen[0])).toEqual({
      offset: '40',
      limit: '20',
      ordering: '-date_joined',
      username__contains: 'an',
      first_name__contains: 'A',
      last_name__contains: 'B',
      email__contains: 'example',
    });
  });

  it('sends only the parameters that are set', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(USERS, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json(userPage([]));
      }),
    );

    await UserClient.list({});

    expect(Object.fromEntries(seen[0])).toEqual({ offset: '0', limit: '10' });
  });

  it('rejects an answer whose rows have no pulp_href', async () => {
    server.use(
      http.get(USERS, () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [{ username: 'x' }],
        }),
      ),
    );

    await expect(UserClient.list({})).rejects.toThrow(ResponseShapeError);
  });

  it('retrieves a user by its address', async () => {
    const row = userRow({ username: 'zz-one' });
    server.use(http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)));

    await expect(UserClient.retrieve(row.pulp_href)).resolves.toMatchObject({
      pulp_href: row.pulp_href,
      username: 'zz-one',
    });
  });

  it('removes a user with one DELETE to its address', async () => {
    const deletes: string[] = [];
    server.use(
      http.delete('*/pulp/api/v3/users/7/', ({ request }) => {
        deletes.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    await UserClient.remove('/pulp/api/v3/users/7/');

    expect(deletes).toEqual(['/pulp/api/v3/users/7/']);
  });

  it('waits for the removal until the server answers 404', async () => {
    let reads = 0;
    server.use(
      http.get('*/pulp/api/v3/users/7/', () => {
        reads += 1;
        return reads < 3
          ? HttpResponse.json({ username: 'zz-ann' })
          : HttpResponse.json({ detail: 'Not found.' }, { status: 404 });
      }),
    );

    await UserClient.confirmRemoved('/pulp/api/v3/users/7/', {
      intervalMs: 1,
    });

    expect(reads).toBe(3);
  });

  it('gives up after the most reads it may make when the user stays', async () => {
    let reads = 0;
    server.use(
      http.get('*/pulp/api/v3/users/7/', () => {
        reads += 1;
        return HttpResponse.json({ username: 'zz-ann' });
      }),
    );

    await expect(
      UserClient.confirmRemoved('/pulp/api/v3/users/7/', {
        intervalMs: 1,
        maxReads: 4,
      }),
    ).rejects.toThrow(RemovalNotConfirmedError);
    expect(reads).toBe(4);
  });

  it('ends the wait at a failure that is not a missing user', async () => {
    let reads = 0;
    server.use(
      http.get('*/pulp/api/v3/users/7/', () => {
        reads += 1;
        return HttpResponse.json({ detail: 'broken' }, { status: 500 });
      }),
    );

    await expect(
      UserClient.confirmRemoved('/pulp/api/v3/users/7/', { intervalMs: 1 }),
    ).rejects.toMatchObject({ response: { status: 500 } });
    expect(reads).toBe(1);
  });
});
