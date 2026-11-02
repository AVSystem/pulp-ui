import { describe, expect, it } from 'vitest';
import { distribution, listOf } from '../test-utils/pulp';
import { server } from '../test-utils/server';
import { distributionConflicts } from './distribution-availability';

const DISTRIBUTIONS = '/pulp/api/v3/distributions/';

// Serves the distributions the way the three availability queries filter
// them: exact name, a set of base paths and a base path fragment.
function serve(existing: ReturnType<typeof distribution>[]) {
  const served = listOf(DISTRIBUTIONS, existing, {
    pageSize: 1000,
    matching: (row, query) => {
      if (query.has('name')) {
        return row.name === query.get('name');
      }
      if (query.has('base_path__in')) {
        return query.get('base_path__in').split(',').includes(row.base_path);
      }
      if (query.has('base_path__contains')) {
        return row.base_path.includes(query.get('base_path__contains'));
      }
      return true;
    },
  });
  server.use(served.handler);
  return served.queries;
}

// Rows that contain "a/" without sitting under "a"; enough of them to fill
// two full pages of the lookup.
const decoyRows = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    distribution({ name: `decoy-${index}`, base_path: `zz/a/${index}` }),
  );

describe('distributionConflicts', () => {
  it('reports a distribution nested below the base path even when it is only on the third page', async () => {
    // the contains match also selects paths that only hold the text
    // elsewhere; those are not descendants of the typed path
    const decoys = decoyRows(1000);
    const nested = distribution({ name: 'nested', base_path: 'a/deep/er' });
    serve([...decoys, nested]);

    const found = await distributionConflicts('fresh', 'a');

    expect(found.basePath).toStrictEqual({
      name: 'nested',
      base_path: 'a/deep/er',
    });
  });

  it('reports no base path conflict when no distribution of any page sits below the path', async () => {
    serve(decoyRows(1001));

    const found = await distributionConflicts('fresh', 'a');

    expect(found.basePath).toBeNull();
  });

  it('asks the nested lookup for only the fields it needs', async () => {
    const queries = serve([]);

    await distributionConflicts('fresh', 'a');

    const nested = queries.filter((query) => query.has('base_path__contains'));
    expect(nested.length).toBeGreaterThan(0);
    nested.forEach((query) =>
      expect(query.get('fields')).toBe('name,base_path,pulp_href'),
    );
  });
});
