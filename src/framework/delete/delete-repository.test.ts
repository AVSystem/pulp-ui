import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileDistribution } from 'src/entities/file/distribution';
import { filePublication } from 'src/entities/file/publication';
import { fileRepository } from 'src/entities/file/repository';
import { setSignedIn } from 'src/session/session-events';
import {
  API,
  DISTRIBUTIONS,
  PUBLICATIONS,
  REPOSITORIES,
  idOf,
  serveDeleteLab as serve,
} from 'src/test-utils/delete-lab';
import {
  type IDistribution,
  distribution,
  inSetOf,
  listOf,
  projectedBy,
  publication,
  repository,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import {
  DeleteNotStarted,
  type DeleteRepositoryResult,
  deleteRepositoryWithDistributions,
  readServingSnapshot,
} from './delete-repository';

// Runs the delete for the distributions the dialog would have shown, unless
// the test says what was shown.
const run = async (
  repo: { name: string; pulp_href: string },
  shown?: { name: string; pulp_href: string }[],
  extra: { signal?: AbortSignal } = {},
) =>
  deleteRepositoryWithDistributions({
    repository: fileRepository,
    distribution: fileDistribution,
    publication: { entity: filePublication },
    target: repo,
    shown: shown ?? (await shownFor(repo)),
    pollMs: 1,
    ...extra,
  });

// The listing the dialog shows: every distribution that serves the repository.
async function shownFor(repo: { pulp_href: string }) {
  const rows = await fileDistribution.index();
  const bound = rows.some(({ publication: bound }) => bound);
  const publications = bound
    ? await filePublication.ofRepository(repo.pulp_href)
    : [];
  const owned = new Set(publications.map(({ pulp_href }) => pulp_href));
  return rows.filter(
    (row) =>
      row.repository === repo.pulp_href ||
      (row.publication && owned.has(row.publication)) ||
      row.repository_version?.startsWith(repo.pulp_href),
  );
}

describe(
  'Integration: deleteRepositoryWithDistributions',
  { tags: ['integration'] },
  () => {
    it('removes every distribution of the repository, bound to it, to a publication of it or to a version of it, on every page of the index, then the repository', async () => {
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
      // the serving ones sit on both pages of the index
      const everything = [
        serving[0],
        ...fillers.slice(0, 500),
        serving[1],
        ...fillers.slice(500, 900),
        serving[2],
        ...fillers.slice(900, 1050),
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
      ).toStrictEqual(['0', '1000']);
    });

    it('deletes a distribution bound both to the repository and to one of its versions once', async () => {
      const repo = repository();
      const both = distribution({
        base_path: 'both',
        repository: repo.pulp_href,
        repository_version: `${repo.pulp_href}versions/1/`,
      });
      const sent = serve({ distributions: [both] });

      const result = await run(repo);

      expect(result.removed).toStrictEqual(['both']);
      expect(
        sent.deletes.filter((path) => path === both.pulp_href),
      ).toHaveLength(1);
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

    it('deletes the repository of a plugin that has no distributions without reading any', async () => {
      const repo = repository();
      const sent = serve({ distributions: [] });

      const result = await deleteRepositoryWithDistributions({
        repository: fileRepository,
        target: repo,
        shown: [],
        pollMs: 1,
      });

      expect(result.repositoryDeleted).toBe(true);
      expect(sent.deletes).toStrictEqual([repo.pulp_href]);
      expect(sent.queries).toStrictEqual([]);
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

    it('keeps waiting for a task that runs for many reads instead of giving up', async () => {
      const repo = repository();
      const only = distribution({
        base_path: 'slow',
        repository: repo.pulp_href,
      });
      const sent = serve({ distributions: [only], runningReads: 40 });

      const result = await run(repo);

      expect(result.removed).toStrictEqual(['slow']);
      expect(result.pending).toStrictEqual([]);
      expect(result.repositoryDeleted).toBe(true);
      expect(sent.polls.get(String(idOf(only.pulp_href)))).toBe(41);
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
            reason:
              'You do not have permission to do this. You do not have permission to perform this action. Contact your organization administrator for more information.',
          },
        ],
        pending: [],
        unknown: [],
        unlisted: [],
        unconfirmed: [],
        notSent: [],
        repositoryDeleted: false,
        repositoryError: null,
        repositoryPending: null,
        repositoryUnknown: null,
        repositoryUnconfirmed: false,
      } satisfies DeleteRepositoryResult);
      expect(sent.deletes).not.toContain(repo.pulp_href);
    });

    it('keeps the repository and reports the task of a distribution whose wait was ended before the task finished', async () => {
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
      const stop = new AbortController();
      setTimeout(() => stop.abort(), 60);

      const result = await run(repo, undefined, { signal: stop.signal });

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

    it('reports the task of the repository delete when its wait was ended before the task finished', async () => {
      const repo = repository();
      serve({
        distributions: [],
        stuck: [{ pulp_href: repo.pulp_href } as IDistribution],
      });
      const stop = new AbortController();
      setTimeout(() => stop.abort(), 40);

      const result = await run(repo, undefined, { signal: stop.signal });

      expect(result.repositoryDeleted).toBe(false);
      expect(result.repositoryPending).toBe(
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

    it('never deletes a distribution of another repository whatever the server answers to the filters', async () => {
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
        listOf(DISTRIBUTIONS, [ours, foreign], {
          pageSize: 1000,
          projected: projectedBy,
        }).handler,
        listOf(PUBLICATIONS, [], { pageSize: 1000, projected: projectedBy })
          .handler,
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
        repositoryError:
          'You do not have permission to do this. The repository is in use. Contact your organization administrator for more information.',
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

    it('reads the publications of the repository only when a distribution is bound to a publication', async () => {
      const repo = repository();
      const bound = distribution({
        base_path: 'bound',
        repository: repo.pulp_href,
      });
      const sent = serve({ distributions: [bound] });
      let publicationReads = 0;
      server.use(
        http.get(`*${PUBLICATIONS}`, () => {
          publicationReads += 1;
          return HttpResponse.json({
            count: 0,
            next: null,
            previous: null,
            results: [],
          });
        }),
      );

      await run(repo);

      expect(publicationReads).toBe(0);
      expect(sent.deletes).toContain(repo.pulp_href);
    });

    describe('when the session ends', () => {
      beforeEach(() => {
        setSignedIn(true);
      });
      afterEach(() => {
        setSignedIn(false);
      });

      it('sends no further distribution delete, keeps the repository and says what was done and what was not sent', async () => {
        const repo = repository();
        const serving = Array.from({ length: 7 }, (_, index) =>
          distribution({
            base_path: `d-${index}`,
            repository: repo.pulp_href,
          }),
        );
        const sent = serve({ distributions: serving });
        const endsAt = serving[1].pulp_href;
        server.use(
          http.delete(`*${DISTRIBUTIONS}:id/`, ({ request, params }) => {
            const path = new URL(request.url).pathname;
            sent.deletes.push(path);
            return path === endsAt
              ? HttpResponse.json({ detail: 'No.' }, { status: 401 })
              : HttpResponse.json(
                  { task: `${API}/tasks/${params.id}/` },
                  { status: 202 },
                );
          }),
        );

        const result = await run(repo);

        // the ones in flight with the refused request cannot be confirmed
        // either: the session is over for all of them
        expect(result.unconfirmed).toContain('d-1');
        expect(result.notSent).toStrictEqual(['d-4', 'd-5', 'd-6']);
        expect(result.failed).toStrictEqual([]);
        expect(result.repositoryDeleted).toBe(false);
        expect(result.repositoryUnconfirmed).toBe(false);
        expect(sent.deletes).not.toContain(repo.pulp_href);
        // every distribution is either removed, not confirmed or never sent
        expect(
          [...result.removed, ...result.unconfirmed, ...result.notSent].sort(),
        ).toStrictEqual(serving.map(({ name }) => name).sort());
        expect(sent.deletes.length).toBeLessThan(serving.length);
      });

      it('does not claim a failure for the repository delete refused with 401', async () => {
        const repo = repository();
        serve({ distributions: [] });
        server.use(
          http.delete(`*${REPOSITORIES}:id/`, () =>
            HttpResponse.json({ detail: 'No.' }, { status: 401 }),
          ),
        );

        const result = await run(repo);

        expect(result.repositoryDeleted).toBe(false);
        expect(result.repositoryError).toBeNull();
        expect(result.repositoryUnconfirmed).toBe(true);
      });

      it('does not claim a failure for a distribution task read refused with 401', async () => {
        const repo = repository();
        const only = distribution({
          base_path: 'only',
          repository: repo.pulp_href,
        });
        const sent = serve({ distributions: [only] });
        server.use(
          http.get(`*${API}/tasks/:id/`, () =>
            HttpResponse.json({ detail: 'No.' }, { status: 401 }),
          ),
        );

        const result = await run(repo);

        expect(result.unconfirmed).toStrictEqual(['only']);
        expect(result.failed).toStrictEqual([]);
        expect(sent.deletes).not.toContain(repo.pulp_href);
      });
    });
  },
);

describe(
  'Integration: deleting many repositories from one reading of the distributions',
  { tags: ['integration'] },
  () => {
    // Two repositories: one served by a distribution bound to it, one by a
    // distribution bound to a publication of it.
    const lab = () => {
      const first = repository();
      const second = repository();
      const bound = distribution({
        base_path: 'by-repository',
        repository: first.pulp_href,
      });
      const viaPublication = publication({
        repository: second.pulp_href,
        repository_version: `${second.pulp_href}versions/1/`,
      });
      const byPublication = distribution({
        base_path: 'by-publication',
        publication: viaPublication.pulp_href,
      });
      const sent = serve({ distributions: [bound, byPublication] });
      const publications = listOf(PUBLICATIONS, [viaPublication], {
        pageSize: 1000,
        matching: (row, query) =>
          (inSetOf(query, 'pulp_href__in') ?? []).includes(row.pulp_href),
        projected: projectedBy,
      });
      server.use(publications.handler);

      return {
        first,
        second,
        bound,
        byPublication,
        sent,
        publicationReads: () => publications.queries,
      };
    };

    it('reads every distribution once and the publications they are bound to in groups, and tells which serve each repository', async () => {
      const { first, second, bound, byPublication, sent, publicationReads } =
        lab();

      const servingOf = await readServingSnapshot({
        distribution: fileDistribution,
        publication: { entity: filePublication },
      });

      expect(servingOf(first.pulp_href).map(({ name }) => name)).toStrictEqual([
        bound.name,
      ]);
      expect(servingOf(second.pulp_href).map(({ name }) => name)).toStrictEqual(
        [byPublication.name],
      );
      expect(servingOf(repository().pulp_href)).toStrictEqual([]);
      expect(sent.queries).toHaveLength(1);
      expect(publicationReads()).toHaveLength(1);
      expect(sent.deletes).toStrictEqual([]);
    });

    it('rejects before anything is sent when the distributions cannot be listed', async () => {
      lab();
      server.use(
        http.get(`*${DISTRIBUTIONS}`, () =>
          HttpResponse.json({ detail: 'Broken.' }, { status: 500 }),
        ),
      );

      await expect(
        readServingSnapshot({
          distribution: fileDistribution,
          publication: { entity: filePublication },
        }),
      ).rejects.toBeInstanceOf(DeleteNotStarted);
    });

    it('deletes with the snapshot it was given and reads nothing of its own, while still holding the delete to what was shown', async () => {
      const { first, bound, sent } = lab();
      const servingOf = await readServingSnapshot({
        distribution: fileDistribution,
        publication: { entity: filePublication },
      });
      const reads = sent.queries.length;

      const shownAll = await deleteRepositoryWithDistributions({
        repository: fileRepository,
        distribution: fileDistribution,
        publication: { entity: filePublication },
        target: first,
        shown: [bound],
        serving: servingOf(first.pulp_href),
        pollMs: 1,
      });

      expect(shownAll).toMatchObject({
        removed: [bound.name],
        repositoryDeleted: true,
      });
      expect(sent.queries).toHaveLength(reads);

      // a distribution that was not shown is reported and keeps the repository
      const other = repository();
      const late = distribution({
        base_path: 'late',
        repository: other.pulp_href,
      });
      const notShown = await deleteRepositoryWithDistributions({
        repository: fileRepository,
        distribution: fileDistribution,
        target: other,
        shown: [],
        serving: [late],
        pollMs: 1,
      });

      expect(notShown.unlisted).toStrictEqual(['late']);
      expect(notShown.repositoryDeleted).toBe(false);
      expect(sent.deletes).not.toContain(other.pulp_href);
    });
  },
);
