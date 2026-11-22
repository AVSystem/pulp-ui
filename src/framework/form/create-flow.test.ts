import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDistribution } from 'src/entities/file/distribution';
import { fileRepository } from 'src/entities/file/repository';
import { setSignedIn } from 'src/session/session-events';
import {
  type IDistribution,
  distribution,
  listOf,
  projectedBy,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import {
  type CreateOutcome,
  type DistributionRequest,
  createAlerts,
  createRepositoryWithDistribution,
  failureReason,
} from './create-flow';

const DISTRIBUTIONS = '/pulp/api/v3/distributions/';
const REPOSITORY_HREF =
  '/pulp/api/v3/repositories/file/file/00000000-0000-4000-8000-0000000000aa/';
const TASK_HREF = '/pulp/api/v3/tasks/00000000-0000-4000-8000-0000000000bb/';

const GUARD_HREF =
  '/pulp/api/v3/contentguards/core/rbac/00000000-0000-4000-8000-0000000000dd/';

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

// The generic distribution list the availability check reads, filtering by the
// three queries the check sends: exact name, a set of base paths and a base
// path fragment.
function serveExistingDistributions(existing: IDistribution[]) {
  const { handler, queries } = listOf(DISTRIBUTIONS, existing, {
    matching: (row, query) => {
      if (query.has('name')) {
        return row.name === query.get('name');
      }
      if (query.has('base_path__in')) {
        return (query.get('base_path__in') as string)
          .split(',')
          .includes(row.base_path);
      }
      if (query.has('base_path__contains')) {
        return row.base_path.includes(query.get('base_path__contains') ?? '');
      }
      return true;
    },
    projected: projectedBy,
  });
  server.use(handler);
  return queries;
}

function serveRepositoryCreate() {
  server.use(
    http.post('*/pulp/api/v3/repositories/file/file/', async ({ request }) => {
      postBodies.push(await jsonBody(request));
      return HttpResponse.json(
        { pulp_href: REPOSITORY_HREF, name: NAME },
        { status: 201 },
      );
    }),
  );
}

function serveRepositoryRefusal(status = 400) {
  server.use(
    http.post('*/pulp/api/v3/repositories/file/file/', async ({ request }) => {
      postBodies.push(await jsonBody(request));
      return HttpResponse.json(
        status === 400
          ? { name: ['This field must be unique.'] }
          : { detail: 'No.' },
        { status },
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

const acceptedTask = () =>
  HttpResponse.json({ task: TASK_HREF }, { status: 202 });

function serveTask(state: string, error?: { description: string }) {
  server.use(
    http.get('*/pulp/api/v3/tasks/:id/', () =>
      HttpResponse.json({
        pulp_href: TASK_HREF,
        name: 'create',
        state,
        error,
      }),
    ),
  );
}

// The request of a distribution; unless a test says otherwise the user chose
// Public.
const asked = (
  basePath: string,
  protection: DistributionRequest['protection'] = 'public',
): DistributionRequest => ({ basePath, protection });

const create = (
  distributionRequest: { basePath: string; protection?: unknown } | null,
  extra: { signal?: AbortSignal; pollMs?: number } = {},
) =>
  createRepositoryWithDistribution({
    repository: fileRepository,
    distributions: fileDistribution,
    body: { name: NAME },
    distribution: distributionRequest
      ? asked(
          distributionRequest.basePath,
          (distributionRequest.protection ??
            'public') as DistributionRequest['protection'],
        )
      : null,
    pollMs: 5,
    ...extra,
  });

const blocked = (outcome: CreateOutcome) => {
  if (outcome.kind !== 'blocked') {
    throw new Error('the create was not blocked');
  }
  return outcome;
};

const created = (outcome: CreateOutcome) => {
  if (outcome.kind !== 'created') {
    throw new Error('the repository was not created');
  }
  return outcome;
};

describe(
  'Integration: createRepositoryWithDistribution',
  { tags: ['integration'] },
  () => {
    describe('when the base path or the name is taken', () => {
      it('is blocked with no POST when another plugin distribution already has the base path', async () => {
        serveExistingDistributions([
          distribution({
            name: 'someone-else',
            base_path: BASE_PATH,
            pulp_href: '/pulp/api/v3/distributions/rpm/rpm/1/',
          }),
        ]);

        const outcome = blocked(await create({ basePath: BASE_PATH }));

        expect(outcome.fields.base_path).toContain('someone-else');
        expect(posts()).toStrictEqual([]);
      });

      it('is blocked with no POST when a distribution sits below the base path', async () => {
        serveExistingDistributions([
          distribution({ name: 'nested', base_path: `${BASE_PATH}/sub` }),
        ]);

        const outcome = blocked(await create({ basePath: BASE_PATH }));

        expect(outcome.fields.base_path).toContain('nested');
        expect(posts()).toStrictEqual([]);
      });

      it('is blocked with no POST when a distribution sits above the base path', async () => {
        serveExistingDistributions([
          distribution({ name: 'parent', base_path: 'acme' }),
        ]);

        const outcome = blocked(await create({ basePath: 'acme/tools' }));

        expect(outcome.fields.base_path).toContain('parent');
        expect(posts()).toStrictEqual([]);
      });

      it('is not blocked by a path that only contains the base path in its middle', async () => {
        serveExistingDistributions([
          distribution({ name: 'elsewhere', base_path: `x/${BASE_PATH}/y` }),
        ]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);
        serveTask('completed');

        const outcome = await create({ basePath: BASE_PATH });

        expect(outcome.kind).toBe('created');
      });

      it('is blocked with no POST when a distribution already has the name', async () => {
        serveExistingDistributions([
          distribution({ name: NAME, base_path: 'something-else' }),
        ]);

        const outcome = blocked(await create({ basePath: BASE_PATH }));

        expect(outcome.fields.name).toContain(NAME);
        expect(posts()).toStrictEqual([]);
      });

      it('names both conflicts when the name and the base path are both taken', async () => {
        serveExistingDistributions([
          distribution({ name: NAME, base_path: 'something-else' }),
          distribution({ name: 'other', base_path: BASE_PATH }),
        ]);

        const outcome = blocked(await create({ basePath: BASE_PATH }));

        expect(Object.keys(outcome.fields).sort()).toStrictEqual([
          'base_path',
          'name',
        ]);
      });

      it('is blocked with no POST when the check itself cannot run', async () => {
        server.use(
          http.get(`*${DISTRIBUTIONS}`, () =>
            HttpResponse.json({ detail: 'broken' }, { status: 500 }),
          ),
        );

        const outcome = blocked(await create({ basePath: BASE_PATH }));

        expect(outcome.general).toContain('Nothing was created');
        expect(posts()).toStrictEqual([]);
      });

      it('compares the name and path the caller gave, without altering them', async () => {
        const queries = serveExistingDistributions([]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);
        serveTask('completed');

        await create({ basePath: 'acme/tools' });

        expect(queries.map((q) => q.get('name')).filter(Boolean)).toStrictEqual(
          [NAME],
        );
        expect(
          queries.map((q) => q.get('base_path__in')).filter(Boolean),
        ).toStrictEqual(['acme,acme/tools']);
      });

      it('reads every page of the nested paths before it decides', async () => {
        const rows = Array.from({ length: 1500 }, (_row, index) =>
          distribution({
            name: `filler-${index}`,
            base_path: `x/${BASE_PATH}/${index}`,
          }),
        );
        rows.push(
          distribution({ name: 'last-one', base_path: `${BASE_PATH}/deep` }),
        );
        serveExistingDistributions(rows);

        const outcome = blocked(await create({ basePath: BASE_PATH }));

        expect(outcome.fields.base_path).toContain('last-one');
        expect(posts()).toStrictEqual([]);
      });
    });

    describe('when both are free', () => {
      it('checks first, then POSTs the repository, then the distribution with the chosen base path and the new repository', async () => {
        serveExistingDistributions([]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);
        serveTask('completed');

        const outcome = await create({ basePath: BASE_PATH });

        expect(outcome).toStrictEqual({
          kind: 'created',
          repositoryHref: REPOSITORY_HREF,
          distribution: { state: 'created' },
        });
        expect(posts().map((r) => r.path)).toStrictEqual([
          '/pulp/api/v3/repositories/file/file/',
          '/pulp/api/v3/distributions/file/file/',
        ]);
        expect(postBodies).toStrictEqual([
          { name: NAME },
          {
            name: NAME,
            base_path: BASE_PATH,
            repository: REPOSITORY_HREF,
            content_guard: null,
          },
        ]);

        // every availability lookup happened before the first write
        const firstPost = seen.findIndex((r) => r.method === 'POST');
        const lastLookup = seen.map((r) => r.path).lastIndexOf(DISTRIBUTIONS);
        expect(lastLookup).toBeGreaterThanOrEqual(0);
        expect(lastLookup).toBeLessThan(firstPost);
      });

      it('creates only the repository, with no distribution request and no lookup, when none was asked for', async () => {
        serveRepositoryCreate();

        const outcome = await create(null);

        expect(outcome).toStrictEqual({
          kind: 'created',
          repositoryHref: REPOSITORY_HREF,
          distribution: { state: 'none' },
        });
        expect(posts().map((r) => r.path)).toStrictEqual([
          '/pulp/api/v3/repositories/file/file/',
        ]);
        expect(postBodies).toStrictEqual([{ name: NAME }]);
        expect(requestsOf('GET', DISTRIBUTIONS)).toHaveLength(0);
      });

      it('reads the distribution task until it has finished, however many reads that takes', async () => {
        serveExistingDistributions([]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);
        let reads = 0;
        server.use(
          http.get('*/pulp/api/v3/tasks/:id/', () => {
            reads += 1;
            return HttpResponse.json({
              pulp_href: TASK_HREF,
              name: 'create',
              state: reads < 6 ? 'running' : 'completed',
            });
          }),
        );

        const outcome = created(await create({ basePath: BASE_PATH }));

        expect(outcome.distribution).toStrictEqual({ state: 'created' });
        expect(reads).toBe(6);
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

        const outcome = created(await create({ basePath: BASE_PATH }));

        expect(outcome.repositoryHref).toBe(REPOSITORY_HREF);
        expect(outcome.distribution).toStrictEqual({
          state: 'failed',
          reason: expect.stringContaining(
            'You do not have permission to perform this action.',
          ),
        });
        expect(requestsOf('POST', '/distributions/file/file/')).toHaveLength(1);
        expect(requestsOf('POST', '/repositories/file/file/')).toHaveLength(1);
        expect(seen.filter((r) => r.method === 'DELETE')).toStrictEqual([]);
      });

      it('reports the task error and never retries when the distribution task fails', async () => {
        serveExistingDistributions([]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);
        serveTask('failed', { description: 'base path overlaps another one' });

        const outcome = created(await create({ basePath: BASE_PATH }));

        expect(outcome.distribution).toStrictEqual({
          state: 'failed',
          reason: 'base path overlaps another one',
        });
        expect(requestsOf('POST', '/distributions/file/file/')).toHaveLength(1);
        expect(seen.filter((r) => r.method === 'DELETE')).toStrictEqual([]);
      });

      it('says a task that failed without a description failed, and gives no other reason', async () => {
        serveExistingDistributions([]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);
        serveTask('canceled');

        const outcome = created(await create({ basePath: BASE_PATH }));

        expect(outcome.distribution).toStrictEqual({
          state: 'failed',
          reason: 'Task failed without error message.',
        });
      });

      it('reports an unknown outcome with the task, not a failure, when the first read of the task fails', async () => {
        serveExistingDistributions([]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);
        server.use(
          http.get('*/pulp/api/v3/tasks/:id/', () =>
            HttpResponse.json({ detail: 'bad gateway' }, { status: 502 }),
          ),
        );

        const outcome = created(await create({ basePath: BASE_PATH }));

        expect(outcome).toStrictEqual({
          kind: 'created',
          repositoryHref: REPOSITORY_HREF,
          distribution: { state: 'unknown', task: TASK_HREF },
        });
        expect(requestsOf('POST', '/distributions/file/file/')).toHaveLength(1);
      });

      it('reports an unknown outcome when the task is refused to the user', async () => {
        serveExistingDistributions([]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);
        let reads = 0;
        server.use(
          http.get('*/pulp/api/v3/tasks/:id/', () => {
            reads += 1;
            return reads === 1
              ? HttpResponse.json({
                  pulp_href: TASK_HREF,
                  name: 'create',
                  state: 'running',
                })
              : HttpResponse.json({ detail: 'No.' }, { status: 403 });
          }),
        );

        const outcome = created(await create({ basePath: BASE_PATH }));

        expect(outcome.distribution).toStrictEqual({
          state: 'unknown',
          task: TASK_HREF,
        });
        expect(reads).toBe(2);
      });

      it('keeps reading after a later read fails for another reason', async () => {
        serveExistingDistributions([]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);
        let reads = 0;
        server.use(
          http.get('*/pulp/api/v3/tasks/:id/', () => {
            reads += 1;
            if (reads === 2) {
              return HttpResponse.json(
                { detail: 'bad gateway' },
                { status: 502 },
              );
            }
            return HttpResponse.json({
              pulp_href: TASK_HREF,
              name: 'create',
              state: reads < 4 ? 'running' : 'completed',
            });
          }),
        );

        const outcome = created(await create({ basePath: BASE_PATH }));

        expect(outcome.distribution).toStrictEqual({ state: 'created' });
        expect(reads).toBe(4);
      });

      it('reports the distribution as still being created, not as failed, when the screen is left before its task ends', async () => {
        serveExistingDistributions([]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);
        const left = new AbortController();
        let reads = 0;
        server.use(
          http.get('*/pulp/api/v3/tasks/:id/', () => {
            reads += 1;
            if (reads === 3) {
              left.abort();
            }
            return HttpResponse.json({
              pulp_href: TASK_HREF,
              name: 'create',
              state: 'running',
            });
          }),
        );

        const outcome = await create(
          { basePath: BASE_PATH },
          { signal: left.signal },
        );

        expect(outcome).toStrictEqual({
          kind: 'created',
          repositoryHref: REPOSITORY_HREF,
          distribution: { state: 'pending', task: TASK_HREF },
        });
        expect(requestsOf('POST', '/distributions/file/file/')).toHaveLength(1);
        expect(seen.filter((r) => r.method === 'DELETE')).toStrictEqual([]);
      });

      it('rejects with the server error and sends no distribution request when the repository is refused', async () => {
        serveExistingDistributions([]);
        serveRepositoryRefusal();

        const outcome = await create({ basePath: BASE_PATH }).catch(
          (e: unknown) => e,
        );

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

    it('sends the fields of the form in the repository body and nothing the caller did not give', async () => {
      serveRepositoryCreate();

      await createRepositoryWithDistribution({
        repository: fileRepository,
        distributions: fileDistribution,
        body: { name: NAME, autopublish: false, retain_repo_versions: null },
      });

      expect(postBodies).toStrictEqual([
        { name: NAME, autopublish: false, retain_repo_versions: null },
      ]);
    });
  },
);

describe(
  'Integration: the protection of the distribution that is created',
  { tags: ['integration'] },
  () => {
    it('sends the address of the chosen guard as the content guard', async () => {
      serveExistingDistributions([]);
      serveRepositoryCreate();
      serveDistributionCreate(acceptedTask);
      serveTask('completed');

      await create({ basePath: BASE_PATH, protection: { guard: GUARD_HREF } });

      expect(postBodies[1]).toStrictEqual({
        name: NAME,
        base_path: BASE_PATH,
        repository: REPOSITORY_HREF,
        content_guard: GUARD_HREF,
      });
    });

    it('sends a null content guard when Public was chosen, and for no other choice', async () => {
      serveExistingDistributions([]);
      serveRepositoryCreate();
      serveDistributionCreate(acceptedTask);
      serveTask('completed');

      await create({ basePath: BASE_PATH, protection: 'public' });

      expect(postBodies[1]).toHaveProperty('content_guard', null);
    });

    it.each([[null], [undefined]])(
      'writes nothing, not even the repository, when the protection is %s',
      async (protection) => {
        serveExistingDistributions([]);
        serveRepositoryCreate();
        serveDistributionCreate(acceptedTask);

        await expect(
          createRepositoryWithDistribution({
            repository: fileRepository,
            distributions: fileDistribution,
            body: { name: NAME },
            distribution: { basePath: BASE_PATH, protection } as never,
            pollMs: 5,
          }),
        ).rejects.toThrow(/protection/);

        expect(posts()).toStrictEqual([]);
        expect(postBodies).toStrictEqual([]);
      },
    );

    it('sends no content guard at all when no distribution is asked for', async () => {
      serveRepositoryCreate();

      await create(null);

      expect(postBodies).toStrictEqual([{ name: NAME }]);
    });
  },
);

describe(
  'Integration: createRepositoryWithDistribution when the session ends',
  { tags: ['integration'] },
  () => {
    beforeEach(() => {
      setSignedIn(true);
    });

    it('reports the repository as created with a warning that the distribution was not confirmed when the distribution request is refused with 401', async () => {
      serveExistingDistributions([]);
      serveRepositoryCreate();
      serveDistributionCreate(() =>
        HttpResponse.json({ detail: 'No.' }, { status: 401 }),
      );

      const outcome = created(await create({ basePath: BASE_PATH }));
      const alerts = createAlerts(
        NAME,
        asked(BASE_PATH),
        outcome.distribution,
      );

      expect(outcome.repositoryHref).toBe(REPOSITORY_HREF);
      expect(outcome.distribution).toStrictEqual({ state: 'unconfirmed' });
      expect(alerts).toEqual([
        {
          variant: 'warning',
          title: `Repository "${NAME}" was created. Its distribution was not confirmed.`,
          description:
            'The session ended before the distribution could be created. After you log in, check the distributions and create it if it is missing.',
        },
      ]);
      expect(requestsOf('POST', '/distributions/file/file/')).toHaveLength(1);
    });

    it('reports the distribution as not confirmed when the session ends while its task is read', async () => {
      serveExistingDistributions([]);
      serveRepositoryCreate();
      serveDistributionCreate(acceptedTask);
      server.use(
        http.get('*/pulp/api/v3/tasks/:id/', () =>
          HttpResponse.json({ detail: 'No.' }, { status: 401 }),
        ),
      );

      const outcome = created(await create({ basePath: BASE_PATH }));

      expect(outcome.distribution).toStrictEqual({ state: 'unconfirmed' });
    });

    it('rejects with the original error, not a blocked create, and sends nothing when the name check is refused with 401', async () => {
      server.use(
        http.get(`*${DISTRIBUTIONS}`, () =>
          HttpResponse.json({ detail: 'No.' }, { status: 401 }),
        ),
      );

      const outcome = await create({ basePath: BASE_PATH }).catch(
        (e: unknown) => e,
      );

      expect(
        (outcome as { response: { status: number } }).response.status,
      ).toBe(401);
      expect(posts()).toStrictEqual([]);
    });

    it('rejects with the original error and sends no distribution request when the repository request is refused with 401', async () => {
      serveExistingDistributions([]);
      serveRepositoryRefusal(401);

      const outcome = await create({ basePath: BASE_PATH }).catch(
        (e: unknown) => e,
      );

      expect(
        (outcome as { response: { status: number } }).response.status,
      ).toBe(401);
      expect(requestsOf('POST', '/distributions/')).toStrictEqual([]);
    });
  },
);

describe('Unit: createAlerts', { tags: ['unit'] }, () => {
  const request = asked(BASE_PATH);

  it('says the repository and the distribution were created, and that the distribution is public', () => {
    expect(createAlerts(NAME, request, { state: 'created' })).toEqual([
      { variant: 'success', title: `Successfully created repository ${NAME}` },
      {
        variant: 'success',
        title: `Created distribution "${NAME}" at base path ${BASE_PATH}.`,
        description:
          'It is public: anyone can download from it without signing in.',
      },
    ]);
  });

  it('says the distribution is protected by the content guard that was chosen', () => {
    expect(
      createAlerts(NAME, asked(BASE_PATH, { guard: GUARD_HREF }), {
        state: 'created',
      }),
    ).toEqual([
      { variant: 'success', title: `Successfully created repository ${NAME}` },
      {
        variant: 'success',
        title: `Created distribution "${NAME}" at base path ${BASE_PATH}.`,
        description: 'It is protected by the content guard you chose.',
      },
    ]);
  });

  it('says only the repository was created when no distribution was asked for', () => {
    expect(createAlerts(NAME, null, { state: 'none' })).toEqual([
      { variant: 'success', title: `Successfully created repository ${NAME}` },
    ]);
  });

  it('says the distribution was not created and why', () => {
    expect(
      createAlerts(NAME, request, { state: 'failed', reason: 'overlap' }),
    ).toEqual([
      {
        variant: 'danger',
        title: `Repository "${NAME}" was created. The distribution "${NAME}" was not created: overlap`,
      },
    ]);
  });

  it('links the task when the distribution is unknown or still being created', () => {
    const [unknown] = createAlerts(NAME, request, {
      state: 'unknown',
      task: TASK_HREF,
    });
    const [pending] = createAlerts(NAME, request, {
      state: 'pending',
      task: TASK_HREF,
    });

    expect(unknown.variant).toBe('warning');
    expect(unknown.title).toContain('is unknown');
    expect(unknown.description).toBeDefined();
    expect(pending.variant).toBe('warning');
    expect(pending.title).toContain('still being created');
    expect(pending.description).toBeDefined();
  });
});

describe('Unit: failureReason', { tags: ['unit'] }, () => {
  it('tells a refusal what was refused, why and whom to ask', () => {
    expect(
      failureReason({
        response: { status: 403, data: { detail: 'No.' } },
      }),
    ).toBe(
      'You do not have permission to do this. No. Contact your organization administrator for more information.',
    );
  });

  it('joins the messages of a rejected request, naming the field of each', () => {
    expect(
      failureReason({
        response: {
          status: 400,
          statusText: 'Bad Request',
          data: { base_path: ['Overlap.'], detail: 'Broken.' },
        },
      }),
    ).toBe('base_path: Overlap. Broken.');
  });

  it('falls back to the status line, the message or the text itself', () => {
    expect(
      failureReason({
        response: { status: 502, statusText: 'Bad Gateway', data: undefined },
      }),
    ).toBe('Error 502 - Bad Gateway');
    expect(failureReason(new Error('boom'))).toBe('boom');
    expect(failureReason('plain')).toBe('plain');
  });
});
