import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { FileDistributionAPI } from 'src/api/file-distribution';
import { FileRepositoryAPI } from 'src/api/file-repository';
import {
  type IDistribution,
  type IPublication,
  distribution,
  listOf,
  publication,
  repository,
  task,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import {
  DeleteNotStarted,
  deleteRepositoryWithDistributions,
} from './delete-repository';
import { repositoryDistributions } from './repository-distributions';

const API = '/pulp/api/v3';
const DISTRIBUTIONS = `${API}/distributions/file/file/`;
const PUBLICATIONS = `${API}/publications/file/file/`;
const REPOSITORIES = `${API}/repositories/file/file/`;

const fast = { waitMs: 1, multiplier: 1, bailAfter: 2 };

const idOf = (href: string) => href.split('/').filter(Boolean).pop();

interface Scenario {
  distributions: IDistribution[];
  publications?: IPublication[];
  // distributions whose delete the server refuses
  refused?: IDistribution[];
  // distributions whose delete task never finishes
  stuck?: IDistribution[];
  // the server refuses to delete the repository
  repositoryRefused?: boolean;
}

// Serves the file plugin the way the server does (the repository filter on the
// distribution and publication lists, delete answered with a task, a task that
// is running for one poll before it completes) and records what the code sent.
function serve({
  distributions,
  publications = [],
  refused = [],
  stuck = [],
  repositoryRefused = false,
}: Scenario) {
  const deletes: string[] = [];
  const events: string[] = [];
  const listing = listOf(DISTRIBUTIONS, distributions, {
    pageSize: 1000,
    matching: (row, query) =>
      query.has('repository')
        ? row.repository === query.get('repository')
        : true,
  });
  const polls = new Map<string, number>();
  const distributionTasks = new Set<string>();
  let inFlight = 0;
  let maxInFlight = 0;

  const refusedHrefs = new Set(refused.map(({ pulp_href }) => pulp_href));
  const stuckIds = new Set(stuck.map(({ pulp_href }) => idOf(pulp_href)));

  server.use(
    listing.handler,
    listOf(PUBLICATIONS, publications, {
      pageSize: 1000,
      matching: (row, query) => row.repository === query.get('repository'),
    }).handler,
    http.delete(`*${DISTRIBUTIONS}:id/`, ({ request, params }) => {
      const path = new URL(request.url).pathname;
      deletes.push(path);
      if (refusedHrefs.has(path)) {
        return HttpResponse.json(
          { detail: 'You do not have permission to perform this action.' },
          { status: 403 },
        );
      }
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      distributionTasks.add(String(params.id));
      return HttpResponse.json(
        { task: `${API}/tasks/${params.id}/` },
        { status: 202 },
      );
    }),
    http.delete(`*${REPOSITORIES}:id/`, ({ request, params }) => {
      const path = new URL(request.url).pathname;
      deletes.push(path);
      events.push('repository-delete');
      if (repositoryRefused) {
        return HttpResponse.json(
          { detail: 'The repository is in use.' },
          { status: 403 },
        );
      }
      return HttpResponse.json(
        { task: `${API}/tasks/${params.id}/` },
        { status: 202 },
      );
    }),
    http.get(`*${API}/tasks/:id/`, ({ params }) => {
      const id = String(params.id);
      const seen = (polls.get(id) ?? 0) + 1;
      polls.set(id, seen);

      const state = stuckIds.has(id) || seen < 2 ? 'running' : 'completed';
      if (state === 'completed' && distributionTasks.has(id)) {
        inFlight -= 1;
        events.push(`distribution-completed:${id}`);
      }
      return HttpResponse.json(
        task({ pulp_href: `${API}/tasks/${id}/`, state }),
      );
    }),
  );

  return {
    deletes,
    events,
    queries: listing.queries,
    maxInFlight: () => maxInFlight,
  };
}

// Runs the delete for the distributions the dialog would have shown, unless
// the test says what was shown.
const run = async (
  repo: { name: string; pulp_href: string },
  shown?: { name: string; pulp_href: string }[],
) =>
  deleteRepositoryWithDistributions({
    plugin: 'file',
    RepositoryAPI: FileRepositoryAPI,
    DistributionAPI: FileDistributionAPI,
    repository: repo,
    shown:
      shown ??
      (await repositoryDistributions('file', repo.pulp_href, {
        complete: true,
      })),
    wait: fast,
  });

describe('deleteRepositoryWithDistributions', () => {
  it('removes every distribution of the repository on every page of the scan, then the repository', async () => {
    const repo = repository();
    const repoPublication = publication({
      repository: repo.pulp_href,
      repository_version: `${repo.pulp_href}versions/1/`,
    });
    const serving = [
      distribution({
        base_path: 'a-by-repository',
        repository: repo.pulp_href,
      }),
      distribution({
        base_path: 'b-by-publication',
        publication: repoPublication.pulp_href,
      }),
      distribution({
        base_path: 'c-by-version',
        repository_version: `${repo.pulp_href}versions/2/`,
      }),
      distribution({
        base_path: 'd-late-publication',
        publication: repoPublication.pulp_href,
      }),
      distribution({
        base_path: 'e-late-version',
        repository_version: `${repo.pulp_href}versions/0/`,
      }),
    ];
    const other = repository();
    const fillers = Array.from({ length: 1100 }, (_, index) =>
      distribution({
        base_path: `filler-${index}`,
        repository: other.pulp_href,
      }),
    );
    // the serving ones sit on all three pages of the scan
    const everything = [
      serving[0],
      ...fillers.slice(0, 300),
      serving[1],
      ...fillers.slice(300, 700),
      serving[2],
      ...fillers.slice(700, 1050),
      serving[3],
      ...fillers.slice(1050),
      serving[4],
    ];
    const sent = serve({
      distributions: everything,
      publications: [repoPublication],
    });

    const result = await run(repo, serving);

    expect(result).toMatchObject({
      removed: [
        'a-by-repository',
        'b-by-publication',
        'c-by-version',
        'd-late-publication',
        'e-late-version',
      ],
      failed: [],
      pending: [],
      repositoryDeleted: true,
    });
    expect([...sent.deletes].sort()).toStrictEqual(
      [...serving.map(({ pulp_href }) => pulp_href), repo.pulp_href].sort(),
    );
    expect(
      sent.queries
        .filter((q) => !q.has('repository'))
        .map((q) => q.get('offset')),
    ).toStrictEqual(['0', '500', '1000']);
  });

  it('deletes a distribution found both by the repository filter and by the scan once', async () => {
    const repo = repository();
    const both = distribution({
      base_path: 'both',
      repository: repo.pulp_href,
      repository_version: `${repo.pulp_href}versions/1/`,
    });
    const sent = serve({ distributions: [both] });

    const result = await run(repo);

    expect(result.removed).toStrictEqual(['both']);
    expect(sent.deletes.filter((path) => path === both.pulp_href)).toHaveLength(
      1,
    );
  });

  it('deletes only the repository when no distribution serves it', async () => {
    const repo = repository();
    const sent = serve({
      distributions: [distribution({ repository: repository().pulp_href })],
    });

    const result = await run(repo);

    expect(result).toMatchObject({
      removed: [],
      failed: [],
      pending: [],
      repositoryDeleted: true,
    });
    expect(sent.deletes).toStrictEqual([repo.pulp_href]);
  });

  it('sends the repository delete only after every distribution delete task completed', async () => {
    const repo = repository();
    const serving = Array.from({ length: 6 }, (_, index) =>
      distribution({ base_path: `d-${index}`, repository: repo.pulp_href }),
    );
    const sent = serve({ distributions: serving });

    await run(repo);

    const repositoryDelete = sent.events.indexOf('repository-delete');
    const completed = sent.events.filter((event) =>
      event.startsWith('distribution-completed:'),
    );
    expect(completed).toHaveLength(6);
    expect(repositoryDelete).toBe(sent.events.length - 1);
  });

  it('never has more than four distribution deletes in flight', async () => {
    const repo = repository();
    const serving = Array.from({ length: 9 }, (_, index) =>
      distribution({ base_path: `d-${index}`, repository: repo.pulp_href }),
    );
    const sent = serve({ distributions: serving });

    const result = await run(repo);

    expect(result.removed).toHaveLength(9);
    expect(sent.maxInFlight()).toBe(4);
  });

  it('keeps the repository when one distribution delete is refused and reports what was removed and why the other failed', async () => {
    const repo = repository();
    const first = distribution({
      base_path: 'a-first',
      repository: repo.pulp_href,
    });
    const refused = distribution({
      base_path: 'b-refused',
      repository: repo.pulp_href,
    });
    const last = distribution({
      base_path: 'c-last',
      repository: repo.pulp_href,
    });
    const sent = serve({
      distributions: [first, refused, last],
      refused: [refused],
    });

    const result = await run(repo);

    expect(result).toStrictEqual({
      removed: ['a-first', 'c-last'],
      failed: [
        {
          name: 'b-refused',
          reason: 'You do not have permission to perform this action.',
        },
      ],
      pending: [],
      unknown: [],
      unlisted: [],
      repositoryDeleted: false,
      repositoryError: null,
      repositoryPending: null,
      repositoryUnknown: null,
    });
    expect(sent.deletes).not.toContain(repo.pulp_href);
  });

  it('keeps the repository and reports the task of a distribution that is still being removed', async () => {
    const repo = repository();
    const done = distribution({
      base_path: 'a-done',
      repository: repo.pulp_href,
    });
    const stuck = distribution({
      base_path: 'b-stuck',
      repository: repo.pulp_href,
    });
    const sent = serve({ distributions: [done, stuck], stuck: [stuck] });

    const result = await run(repo);

    expect(result.removed).toStrictEqual(['a-done']);
    expect(result.failed).toStrictEqual([]);
    expect(result.pending).toStrictEqual([
      { name: 'b-stuck', taskHref: `${API}/tasks/${idOf(stuck.pulp_href)}/` },
    ]);
    expect(result.repositoryDeleted).toBe(false);
    expect(sent.deletes).not.toContain(repo.pulp_href);
  });

  it('reports an unknown outcome, not a failure, for a distribution whose task status cannot be read, and keeps the repository', async () => {
    const repo = repository();
    const first = distribution({
      base_path: 'a-first',
      repository: repo.pulp_href,
    });
    const unreadable = distribution({
      base_path: 'b-unreadable',
      repository: repo.pulp_href,
    });
    const sent = serve({ distributions: [first, unreadable] });
    server.use(
      http.get(`*${API}/tasks/${idOf(unreadable.pulp_href)}/`, () =>
        HttpResponse.json({ detail: 'bad gateway' }, { status: 502 }),
      ),
    );

    const result = await run(repo);

    expect(result.removed).toStrictEqual(['a-first']);
    expect(result.failed).toStrictEqual([]);
    expect(result.unknown).toStrictEqual([
      {
        name: 'b-unreadable',
        taskHref: `${API}/tasks/${idOf(unreadable.pulp_href)}/`,
      },
    ]);
    expect(result.repositoryDeleted).toBe(false);
    expect(sent.deletes).not.toContain(repo.pulp_href);
  });

  it('reports an unknown outcome for the repository delete when its task status cannot be read', async () => {
    const repo = repository();
    serve({ distributions: [] });
    server.use(
      http.get(`*${API}/tasks/${idOf(repo.pulp_href)}/`, () =>
        HttpResponse.json({ detail: 'bad gateway' }, { status: 502 }),
      ),
    );

    const result = await run(repo);

    expect(result.repositoryDeleted).toBe(false);
    expect(result.repositoryError).toBeNull();
    expect(result.repositoryUnknown).toBe(
      `${API}/tasks/${idOf(repo.pulp_href)}/`,
    );
  });

  it('does not delete a distribution that was not shown, reports it, deletes the shown ones and keeps the repository', async () => {
    const repo = repository();
    const shown = distribution({
      base_path: 'a-shown',
      repository: repo.pulp_href,
    });
    const late = distribution({
      base_path: 'b-created-later',
      repository: repo.pulp_href,
    });
    const sent = serve({ distributions: [shown, late] });

    const result = await run(repo, [shown]);

    expect(result.removed).toStrictEqual(['a-shown']);
    expect(result.unlisted).toStrictEqual(['b-created-later']);
    expect(result.repositoryDeleted).toBe(false);
    expect(sent.deletes).toStrictEqual([shown.pulp_href]);
  });

  it('leaves alone a shown distribution that no longer serves the repository', async () => {
    const repo = repository();
    const other = repository();
    const stays = distribution({
      base_path: 'a-stays',
      repository: repo.pulp_href,
    });
    const moved = distribution({
      base_path: 'b-moved',
      repository: other.pulp_href,
    });
    const sent = serve({ distributions: [stays, moved] });

    const result = await run(repo, [stays, moved]);

    expect(result.removed).toStrictEqual(['a-stays']);
    expect(sent.deletes).not.toContain(moved.pulp_href);
    expect(result.repositoryDeleted).toBe(true);
  });

  it('never deletes a distribution of another repository when the server ignores the repository filter', async () => {
    const repo = repository();
    const other = repository();
    const ours = distribution({
      base_path: 'a-ours',
      repository: repo.pulp_href,
    });
    const foreign = distribution({
      base_path: 'b-foreign',
      repository: other.pulp_href,
    });
    const sent = serve({ distributions: [ours, foreign] });
    // the lists answer with every row of the plugin
    server.use(
      listOf(DISTRIBUTIONS, [ours, foreign], { pageSize: 1000 }).handler,
      listOf(PUBLICATIONS, [], { pageSize: 1000 }).handler,
    );

    const result = await run(repo, [ours]);

    expect(sent.deletes).toStrictEqual([ours.pulp_href, repo.pulp_href]);
    expect(result.removed).toStrictEqual(['a-ours']);
    expect(result.unlisted).toStrictEqual([]);
    expect(result.repositoryDeleted).toBe(true);
  });

  it('says why the repository itself was not removed once every distribution is gone', async () => {
    const repo = repository();
    const only = distribution({
      base_path: 'only',
      repository: repo.pulp_href,
    });
    serve({ distributions: [only], repositoryRefused: true });

    const result = await run(repo);

    expect(result).toMatchObject({
      removed: ['only'],
      failed: [],
      pending: [],
      repositoryDeleted: false,
      repositoryError: 'The repository is in use.',
    });
  });

  it('rejects without sending any delete when the distributions cannot be listed', async () => {
    const repo = repository();
    const sent = serve({ distributions: [] });
    server.use(
      http.get(`*${DISTRIBUTIONS}`, () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    );

    const outcome = await run(repo, []).catch((e: unknown) => e);

    expect(outcome).toBeInstanceOf(DeleteNotStarted);
    expect((outcome as DeleteNotStarted).cause).toMatchObject({
      response: { status: 500 },
    });
    expect(sent.deletes).toStrictEqual([]);
  });

  it('never deletes a distribution that serves another repository', async () => {
    const repo = repository();
    const other = repository();
    const repoPublication = publication({
      repository: repo.pulp_href,
      repository_version: `${repo.pulp_href}versions/1/`,
    });
    const otherPublication = publication({
      repository: other.pulp_href,
      repository_version: `${other.pulp_href}versions/1/`,
    });

    const serving = [
      distribution({
        base_path: 'ours-by-repository',
        repository: repo.pulp_href,
      }),
      distribution({
        base_path: 'ours-by-publication',
        publication: repoPublication.pulp_href,
      }),
      distribution({
        base_path: 'ours-by-version',
        repository_version: `${repo.pulp_href}versions/3/`,
      }),
    ];
    const foreign = [
      distribution({
        base_path: 'foreign-by-publication',
        publication: otherPublication.pulp_href,
      }),
      distribution({
        base_path: 'foreign-by-version',
        repository_version: `${other.pulp_href}versions/3/`,
      }),
      distribution({
        base_path: 'foreign-by-repository',
        repository: other.pulp_href,
      }),
    ];
    // the publication list answers with the publications of the repository
    // being deleted only, so the foreign ones are told apart by their binding
    const sent = serve({
      distributions: [...foreign, ...serving],
      publications: [repoPublication, otherPublication],
    });

    const result = await run(repo);

    foreign.forEach(({ pulp_href, name }) => {
      expect(sent.deletes, name).not.toContain(pulp_href);
    });
    expect(result.removed).toStrictEqual([
      'ours-by-publication',
      'ours-by-repository',
      'ours-by-version',
    ]);
    expect(result.repositoryDeleted).toBe(true);
    expect([...sent.deletes].sort()).toStrictEqual(
      [...serving.map(({ pulp_href }) => pulp_href), repo.pulp_href].sort(),
    );
  });
});
