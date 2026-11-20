import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from 'src/test-utils/server';
import { GroupRoleClient } from './core/group-role/client';
import { GroupClient } from './core/group/client';
import { pageOfMembers } from './core/group/model';
import { RoleClient } from './core/role/client';
import { TaskClient } from './core/task/client';
import { UserClient } from './core/user/client';
import { positiveInt } from './page-params';

describe('positiveInt', { tags: ['unit'] }, () => {
  it('keeps a whole number of at least one', () => {
    expect(positiveInt(1, 9)).toBe(1);
    expect(positiveInt(25, 9)).toBe(25);
    expect(positiveInt('3', 9)).toBe(3);
  });

  it('cuts a fraction to its whole part', () => {
    expect(positiveInt(2.9, 9)).toBe(2);
    expect(positiveInt('4.2', 9)).toBe(4);
  });

  it('falls back for a value that is not a usable number', () => {
    for (const value of [
      undefined,
      null,
      NaN,
      'abc',
      '',
      {},
      0,
      -3,
      0.5,
      Infinity,
      -Infinity,
      'Infinity',
    ]) {
      expect(positiveInt(value, 9)).toBe(9);
    }
  });

  it('reads the first value of a repeated parameter', () => {
    expect(positiveInt([2, 5], 9)).toBe(2);
    expect(positiveInt(['7', '1'], 9)).toBe(7);
    expect(positiveInt(['x', 3], 9)).toBe(9);
    expect(positiveInt([], 9)).toBe(9);
  });
});

// What an address such as ?page=abc or ?page=1&page=2 turns into on the way to
// the clients: a value that is not a number.
const BAD = { page: NaN, page_size: NaN } as const;
const REPEATED = { page: [2, 3], page_size: [5, 6] } as unknown as {
  page: number;
  page_size: number;
};

describe(
  'entity clients with page parameters from the address',
  { tags: ['integration'] },
  () => {
    const EMPTY = { count: 0, next: null, previous: null, results: [] };
    const GROUP = '/pulp/api/v3/groups/7/';

    const readers: Record<
      string,
      {
        url: string;
        read: (params: { page: number; page_size: number }) => Promise<unknown>;
      }
    > = {
      users: {
        url: '*/pulp/api/v3/users/',
        read: (params) => UserClient.list(params),
      },
      groups: {
        url: '*/pulp/api/v3/groups/',
        read: (params) => GroupClient.list(params),
      },
      roles: {
        url: '*/pulp/api/v3/roles/',
        read: (params) => RoleClient.list(params),
      },
      tasks: {
        url: '*/pulp/api/v3/tasks/',
        read: (params) => TaskClient.list(params),
      },
      'group roles': {
        url: `*${GROUP}roles/`,
        read: (params) => GroupRoleClient.list(GROUP, params),
      },
    };

    async function queryOf(
      name: string,
      params: { page: number; page_size: number },
    ) {
      const seen: URLSearchParams[] = [];
      server.use(
        http.get(readers[name].url, ({ request }) => {
          seen.push(new URL(request.url).searchParams);
          return HttpResponse.json(EMPTY);
        }),
      );
      await readers[name].read(params);
      return Object.fromEntries(seen[0]);
    }

    it.each(Object.keys(readers))(
      'sends the first page of the default size for a page that is not a number (%s)',
      async (name) => {
        const query = await queryOf(name, BAD);

        expect(query['offset']).toBe('0');
        expect(query['limit']).toBe('10');
      },
    );

    it.each(Object.keys(readers))(
      'uses the first value of a repeated page and page size (%s)',
      async (name) => {
        const query = await queryOf(name, REPEATED);

        expect(query['offset']).toBe('5');
        expect(query['limit']).toBe('5');
      },
    );

    it('cuts the first page of the default size of the members for a page that is not a number', () => {
      const members = Array.from({ length: 25 }, (_, i) => ({
        pulp_href: `/pulp/api/v3/users/${i + 1}/`,
        username: `user-${String(i).padStart(2, '0')}`,
      }));

      const page = pageOfMembers(members as never, BAD);

      expect(page.count).toBe(25);
      expect(page.results).toHaveLength(10);
      expect(page.results[0].username).toBe('user-00');
    });
  },
);
