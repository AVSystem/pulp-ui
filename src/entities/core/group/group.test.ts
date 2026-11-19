import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError, parseResponse } from 'src/entities/response-shape';
import { server } from 'src/test-utils/server';
import { GroupClient } from './client';
import { groupPageSchema, groupSchema } from './model';
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
  });
});
