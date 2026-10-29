import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileDistributionAPI } from 'src/api/file-distribution';
import { FileRepositoryAPI } from 'src/api/file-repository';
import { type IDistribution, distribution, listOf } from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { CreateBlocked, createRepository } from './create-repository';

const DISTRIBUTIONS = '/pulp/api/v3/distributions/';
const REPOSITORY_HREF =
  '/pulp/api/v3/repositories/file/file/00000000-0000-4000-8000-0000000000aa/';
const TASK_HREF = '/pulp/api/v3/tasks/00000000-0000-4000-8000-0000000000bb/';

const NAME = 'Acme Tools';
const BASE_PATH = 'acme-tools';

interface Seen {
  method: string;
  path: string;
}

// every request the code under test makes, in order, and the JSON body of
// every POST
let seen: Seen[];
let postBodies: Record<string, unknown>[];

beforeEach(() => {
  seen = [];
  postBodies = [];
  server.events.on('request:start', ({ request }) => {
    seen.push({ method: request.method, path: new URL(request.url).pathname });
  });
});

afterEach(() => {
  server.events.removeAllListeners();
});

const jsonBody = async (request: Request) =>
  (await request.json()) as Record<string, unknown>;

const requestsOf = (method: string, pathPart: string) =>
  seen.filter((r) => r.method === method && r.path.includes(pathPart));

const posts = () => seen.filter((r) => r.method === 'POST');

// The generic distribution list the availability check reads, filtering by
// the three queries the check sends: exact name, a set of base paths and a
// base path fragment.
function serveExistingDistributions(existing: IDistribution[]) {
  const { handler, queries } = listOf(DISTRIBUTIONS, existing, {
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
  server.use(handler);
  return queries;
}

function serveRepositoryCreate() {
  server.use(
    http.post('*/pulp/api/v3/repositories/file/file/', async ({ request }) => {
      postBodies.push(await jsonBody(request));
      return HttpResponse.json({ pulp_href: REPOSITORY_HREF }, { status: 201 });
    }),
  );
}

function serveRepositoryRefusal() {
  server.use(
    http.post('*/pulp/api/v3/repositories/file/file/', async ({ request }) => {
      postBodies.push(await jsonBody(request));
      return HttpResponse.json(
        { name: ['This field must be unique.'] },
        { status: 400 },
      );
    }),
  );
}

function serveDistributionCreate(answer: () => Response | Promise<Response>) {
  server.use(
    http.post('*/pulp/api/v3/distributions/file/file/', async ({ request }) => {
      postBodies.push(await jsonBody(request));
      return answer();
    }),
  );
}

function serveTask(state: string, error?: { description: string }) {
  server.use(
    http.get('*/pulp/api/v3/tasks/:id/', () =>
      HttpResponse.json({ pulp_href: TASK_HREF, state, error }),
    ),
  );
}

const create = (distributionRequest: { basePath: string } | null) =>
  createRepository({
    RepositoryAPI: FileRepositoryAPI,
    DistributionAPI: FileDistributionAPI,
    data: { name: NAME },
    distribution: distributionRequest,
  });

describe('createRepository', () => {
  describe('when the base path or the name is taken', () => {
    it('is blocked with no POST when another plugin distribution already has the base path', async () => {
      serveExistingDistributions([
        distribution({
          name: 'someone-else',
          base_path: BASE_PATH,
          pulp_href: '/pulp/api/v3/distributions/rpm/rpm/1/',
        }),
      ]);

      const outcome = await create({ basePath: BASE_PATH }).then(
        () => null,
        (e: unknown) => e,
      );

      expect(outcome).toBeInstanceOf(CreateBlocked);
      expect((outcome as CreateBlocked).errors['base_path']).toContain(
        'someone-else',
      );
      expect(posts()).toStrictEqual([]);
    });

    it('is blocked with no POST when a distribution sits below the base path', async () => {
      serveExistingDistributions([
        distribution({ name: 'nested', base_path: `${BASE_PATH}/sub` }),
      ]);

      const outcome = await create({ basePath: BASE_PATH }).catch(
        (e: unknown) => e,
      );

      expect(outcome).toBeInstanceOf(CreateBlocked);
      expect(posts()).toStrictEqual([]);
    });

    it('is blocked with no POST when a distribution sits above the base path', async () => {
      serveExistingDistributions([
        distribution({ name: 'parent', base_path: 'acme' }),
      ]);

      const outcome = await create({ basePath: 'acme/tools' }).catch(
        (e: unknown) => e,
      );

      expect(outcome).toBeInstanceOf(CreateBlocked);
      expect(posts()).toStrictEqual([]);
    });

    it('is blocked with no POST when a distribution already has the name', async () => {
      serveExistingDistributions([
        distribution({ name: NAME, base_path: 'something-else' }),
      ]);

      const outcome = await create({ basePath: BASE_PATH }).catch(
        (e: unknown) => e,
      );

      expect(outcome).toBeInstanceOf(CreateBlocked);
      expect((outcome as CreateBlocked).errors['name']).toContain(NAME);
      expect(posts()).toStrictEqual([]);
    });

    it('is blocked with no POST when the check itself cannot run', async () => {
      server.use(
        http.get(`*${DISTRIBUTIONS}`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );

      const outcome = await create({ basePath: BASE_PATH }).catch(
        (e: unknown) => e,
      );

      expect(outcome).toBeInstanceOf(CreateBlocked);
      expect((outcome as CreateBlocked).message).toContain(
        'Nothing was created',
      );
      expect(posts()).toStrictEqual([]);
    });

    it('compares the name and path the caller gave, without altering them', async () => {
      const queries = serveExistingDistributions([]);
      serveRepositoryCreate();
      serveDistributionCreate(() =>
        HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
      );
      serveTask('completed');

      await create({ basePath: 'acme/tools' });

      expect(queries.map((q) => q.get('name')).filter(Boolean)).toStrictEqual([
        NAME,
      ]);
      expect(
        queries.map((q) => q.get('base_path__in')).filter(Boolean),
      ).toStrictEqual(['acme,acme/tools']);
    });
  });

  describe('when both are free', () => {
    it('checks first, then POSTs the repository, then the distribution with the chosen base path and the new repository', async () => {
      serveExistingDistributions([]);
      serveRepositoryCreate();
      serveDistributionCreate(() =>
        HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
      );
      serveTask('completed');

      const result = await create({ basePath: BASE_PATH });

      expect(result).toStrictEqual({
        repositoryHref: REPOSITORY_HREF,
        distributionError: null,
      });
      expect(posts().map((r) => r.path)).toStrictEqual([
        '/pulp/api/v3/repositories/file/file/',
        '/pulp/api/v3/distributions/file/file/',
      ]);
      expect(postBodies).toStrictEqual([
        { name: NAME },
        { name: NAME, base_path: BASE_PATH, repository: REPOSITORY_HREF },
      ]);

      // every availability lookup happened before the first write
      const firstPost = seen.findIndex((r) => r.method === 'POST');
      const lastLookup = seen.map((r) => r.path).lastIndexOf(DISTRIBUTIONS);
      expect(lastLookup).toBeGreaterThanOrEqual(0);
      expect(lastLookup).toBeLessThan(firstPost);
    });

    it('creates only the repository, with no distribution request, when none was asked for', async () => {
      serveRepositoryCreate();

      const result = await create(null);

      expect(result).toStrictEqual({
        repositoryHref: REPOSITORY_HREF,
        distributionError: null,
      });
      expect(posts().map((r) => r.path)).toStrictEqual([
        '/pulp/api/v3/repositories/file/file/',
      ]);
      expect(postBodies).toStrictEqual([{ name: NAME }]);
    });
  });

  describe('when something fails after the checks passed', () => {
    it('keeps the repository, makes no second distribution POST and no DELETE, and reports the server reason when the distribution is refused', async () => {
      serveExistingDistributions([]);
      serveRepositoryCreate();
      serveDistributionCreate(() =>
        HttpResponse.json(
          { detail: 'You do not have permission to perform this action.' },
          { status: 403 },
        ),
      );

      const result = await create({ basePath: BASE_PATH });

      expect(result.repositoryHref).toBe(REPOSITORY_HREF);
      expect(result.distributionError).toContain(
        'You do not have permission to perform this action.',
      );
      expect(requestsOf('POST', '/distributions/file/file/')).toHaveLength(1);
      expect(requestsOf('POST', '/repositories/file/file/')).toHaveLength(1);
      expect(seen.filter((r) => r.method === 'DELETE')).toStrictEqual([]);
    });

    it('reports the task error and never retries when the distribution task fails', async () => {
      serveExistingDistributions([]);
      serveRepositoryCreate();
      serveDistributionCreate(() =>
        HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
      );
      serveTask('failed', { description: 'base path overlaps another one' });

      const result = await create({ basePath: BASE_PATH });

      expect(result.distributionError).toBe('base path overlaps another one');
      expect(requestsOf('POST', '/distributions/file/file/')).toHaveLength(1);
      expect(seen.filter((r) => r.method === 'DELETE')).toStrictEqual([]);
    });

    it('rejects with the server error and sends no distribution request when the repository is refused', async () => {
      serveExistingDistributions([]);
      serveRepositoryRefusal();

      const outcome = await create({ basePath: BASE_PATH }).catch(
        (e: unknown) => e,
      );

      expect(outcome).not.toBeInstanceOf(CreateBlocked);
      expect(
        (outcome as { response: { status: number } }).response.status,
      ).toBe(400);
      expect(requestsOf('POST', '/distributions/')).toStrictEqual([]);
      expect(requestsOf('POST', '/repositories/file/file/')).toHaveLength(1);
    });
  });

  it('never sends a name that differs from the one given, whatever happens', async () => {
    serveExistingDistributions([]);
    serveRepositoryCreate();
    serveDistributionCreate(() =>
      HttpResponse.json({ detail: 'refused' }, { status: 403 }),
    );

    await create({ basePath: BASE_PATH });

    expect(postBodies.length).toBeGreaterThan(0);
    for (const body of postBodies) {
      expect(body['name']).toBe(NAME);
    }
  });
});
