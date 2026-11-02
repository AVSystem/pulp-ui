import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { GenericDistributionAPI } from '../api/generic-pulp';
import { listOf } from '../test-utils/pulp';
import { server } from '../test-utils/server';
import { listAll } from './list-all';

const DISTRIBUTIONS = '/pulp/api/v3/distributions/';
const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ name: `row-${index}` }));
const list = (params) => GenericDistributionAPI.list(params);

describe('listAll', () => {
  it('returns every row of a list the server serves in several pages', async () => {
    const served = listOf(DISTRIBUTIONS, rows(5), { pageSize: 2 });
    server.use(served.handler);

    const all = await listAll<{ name: string }>(list, {}, 2);

    expect(all.map((row) => row.name)).toStrictEqual([
      'row-0',
      'row-1',
      'row-2',
      'row-3',
      'row-4',
    ]);
    expect(served.queries).toHaveLength(3);
  });

  it('sends the given filters on every page', async () => {
    const served = listOf(DISTRIBUTIONS, rows(3), { pageSize: 2 });
    server.use(served.handler);

    await listAll(list, { fields: 'name' }, 2);

    expect(served.queries.map((query) => query.get('fields'))).toStrictEqual([
      'name',
      'name',
    ]);
  });

  it('returns an empty list for an empty answer with one request', async () => {
    const served = listOf(DISTRIBUTIONS, [], { pageSize: 2 });
    server.use(served.handler);

    expect(await listAll(list, {}, 2)).toStrictEqual([]);
    expect(served.queries).toHaveLength(1);
  });

  it('rejects when a later page fails instead of returning the rows read so far', async () => {
    const served = listOf(DISTRIBUTIONS, rows(5), { pageSize: 2 });
    let requests = 0;
    server.use(
      http.get(`*${DISTRIBUTIONS}`, (info) => {
        requests += 1;
        return requests === 2
          ? HttpResponse.json({}, { status: 500 })
          : undefined;
      }),
      served.handler,
    );

    await expect(listAll(list, {}, 2)).rejects.toMatchObject({
      response: { status: 500 },
    });
  });
});
