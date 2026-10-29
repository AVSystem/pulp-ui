import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  type IDistribution,
  type IPublication,
  distribution,
  listOf,
  publication,
  repository,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import {
  distributionsLoadError,
  repositoryDistributions,
} from './repository-distributions';

const FILE_DISTRIBUTIONS = '/pulp/api/v3/distributions/file/file/';
const FILE_PUBLICATIONS = '/pulp/api/v3/publications/file/file/';
const DEB_DISTRIBUTIONS = '/pulp/api/v3/distributions/deb/apt/';
const DEB_APT_PUBLICATIONS = '/pulp/api/v3/publications/deb/apt/';
const DEB_VERBATIM_PUBLICATIONS = '/pulp/api/v3/publications/deb/verbatim/';

// the server's repository filter on a list endpoint
const ofRepository = (row: { repository: string | null }, q: URLSearchParams) =>
  row.repository === q.get('repository');

// Serves the given rows on the file plugin's distribution and publication
// endpoints, filtering by repository where the server does, and returns the
// recorded queries of both.
function serveFile(
  distributions: IDistribution[],
  publications: IPublication[],
) {
  const distributionList = listOf(FILE_DISTRIBUTIONS, distributions, {
    pageSize: 1000,
    matching: (row, query) =>
      query.has('repository') ? ofRepository(row, query) : true,
  });
  const publicationList = listOf(FILE_PUBLICATIONS, publications, {
    pageSize: 1000,
    matching: ofRepository,
  });
  server.use(distributionList.handler, publicationList.handler);
  return {
    distributionQueries: distributionList.queries,
    publicationQueries: publicationList.queries,
  };
}

describe('repositoryDistributions', () => {
  it('finds the distributions bound to the repository, to one of its publications and to one of its versions, each with the server base_url', async () => {
    const repo = repository();
    const other = repository();
    const repoPublication = publication({
      repository: repo.pulp_href,
      repository_version: `${repo.pulp_href}versions/1/`,
    });
    const otherPublication = publication({ repository: other.pulp_href });

    const boundToRepository = distribution({
      base_path: 'by-repository',
      base_url: 'https://pulp.example/content/served-by-repository/',
      repository: repo.pulp_href,
    });
    const boundToPublication = distribution({
      base_path: 'by-publication',
      base_url: 'https://pulp.example/content/served-by-publication/',
      publication: repoPublication.pulp_href,
    });
    const boundToVersion = distribution({
      base_path: 'by-version',
      base_url: 'https://pulp.example/content/served-by-version/',
      repository_version: `${repo.pulp_href}versions/1/`,
    });
    const unrelated = [
      distribution({
        base_path: 'other-repository',
        repository: other.pulp_href,
      }),
      distribution({
        base_path: 'other-publication',
        publication: otherPublication.pulp_href,
      }),
      distribution({
        base_path: 'other-version',
        repository_version: `${other.pulp_href}versions/0/`,
      }),
      distribution({ base_path: 'bound-to-nothing' }),
    ];

    serveFile(
      [boundToRepository, boundToPublication, boundToVersion, ...unrelated],
      [repoPublication, otherPublication],
    );

    const found = await repositoryDistributions('file', repo.pulp_href);

    expect(
      found.map(({ name, binding, url }) => ({ name, binding, url })),
    ).toStrictEqual([
      {
        name: 'by-publication',
        binding: 'publication',
        url: 'https://pulp.example/content/served-by-publication/',
      },
      {
        name: 'by-repository',
        binding: 'repository',
        url: 'https://pulp.example/content/served-by-repository/',
      },
      {
        name: 'by-version',
        binding: 'repository_version',
        url: 'https://pulp.example/content/served-by-version/',
      },
    ]);
    expect(found.every(({ served }) => served)).toBe(true);
  });

  it('asks the server for the repository filter, the url field and the repository publications', async () => {
    const repo = repository();
    const { distributionQueries, publicationQueries } = serveFile([], []);

    await repositoryDistributions('file', repo.pulp_href);

    const filtered = distributionQueries.filter((q) => q.has('repository'));
    const scans = distributionQueries.filter((q) => !q.has('repository'));

    expect(filtered).toHaveLength(1);
    expect(filtered[0].get('repository')).toBe(repo.pulp_href);
    expect(filtered[0].get('fields')).toContain('base_url');
    expect(scans).toHaveLength(1);
    expect(scans[0].get('fields')).toContain('base_url');
    expect(publicationQueries).toHaveLength(1);
    expect(publicationQueries[0].get('repository')).toBe(repo.pulp_href);
  });

  it('follows the paged scan to later pages for a distribution bound to a version', async () => {
    const repo = repository();
    const filler = Array.from({ length: 599 }, (_, index) =>
      distribution({ base_path: `filler-${index}` }),
    );
    const late = distribution({
      base_path: 'late-version',
      repository_version: `${repo.pulp_href}versions/3/`,
    });
    // the matching one sits on the second page of 500
    const everything = [...filler.slice(0, 550), late, ...filler.slice(550)];

    const { distributionQueries } = serveFile(everything, []);

    const found = await repositoryDistributions('file', repo.pulp_href);

    expect(found.map(({ name }) => name)).toStrictEqual(['late-version']);
    const scanOffsets = distributionQueries
      .filter((q) => !q.has('repository'))
      .map((q) => Number(q.get('offset')));
    expect(scanOffsets).toStrictEqual([0, 500]);
  });

  it('rejects with a readable message when the distribution list answers 500, never an empty list', async () => {
    const repo = repository();
    server.use(
      http.get(`*${FILE_DISTRIBUTIONS}`, () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
      listOf(FILE_PUBLICATIONS, []).handler,
    );

    const failure = await repositoryDistributions('file', repo.pulp_href).then(
      (list) => ({ list }),
      (error) => ({ error }),
    );

    expect(failure).not.toHaveProperty('list');
    expect(
      distributionsLoadError((failure as { error: unknown }).error),
    ).toMatch(/^Error 500 - .*server encountered an error/);
  });

  it('rejects when only the publication list fails, so a partial answer is not shown as complete', async () => {
    const repo = repository();
    server.use(
      listOf(FILE_DISTRIBUTIONS, [distribution({ repository: repo.pulp_href })])
        .handler,
      http.get(`*${FILE_PUBLICATIONS}`, () =>
        HttpResponse.json({ detail: 'nope' }, { status: 403 }),
      ),
    );

    const failure = await repositoryDistributions('file', repo.pulp_href).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).not.toBeNull();
    expect(distributionsLoadError(failure)).toMatch(/^Error 403 - /);
  });

  it('describes a failure without a response by its own message', () => {
    expect(distributionsLoadError(new Error('Network Error'))).toBe(
      'Network Error',
    );
  });

  describe('deb', () => {
    function serveDeb(
      distributions: IDistribution[],
      aptPublications: IPublication[],
      verbatimPublications: IPublication[],
    ) {
      server.use(
        listOf(DEB_DISTRIBUTIONS, distributions, {
          pageSize: 1000,
          matching: (row, query) =>
            query.has('repository') ? ofRepository(row, query) : true,
        }).handler,
        listOf(DEB_APT_PUBLICATIONS, aptPublications, {
          pageSize: 1000,
          matching: ofRepository,
        }).handler,
        listOf(DEB_VERBATIM_PUBLICATIONS, verbatimPublications, {
          pageSize: 1000,
          matching: ofRepository,
        }).handler,
      );
    }

    it('marks a repository-bound distribution not served while the repository has no publication', async () => {
      const repo = repository();
      serveDeb(
        [
          distribution({
            base_path: 'unpublished',
            repository: repo.pulp_href,
          }),
        ],
        [],
        [],
      );

      const found = await repositoryDistributions('deb', repo.pulp_href);

      expect(found).toHaveLength(1);
      expect(found[0].served).toBe(false);
    });

    it('marks it served once the repository has a verbatim publication', async () => {
      const repo = repository();
      serveDeb(
        [distribution({ base_path: 'published', repository: repo.pulp_href })],
        [],
        [publication({ repository: repo.pulp_href })],
      );

      const found = await repositoryDistributions('deb', repo.pulp_href);

      expect(found).toHaveLength(1);
      expect(found[0].served).toBe(true);
    });

    it('marks a version-bound distribution not served when only another version is published', async () => {
      const repo = repository();
      serveDeb(
        [
          distribution({
            base_path: 'pinned',
            repository_version: `${repo.pulp_href}versions/2/`,
          }),
        ],
        [
          publication({
            repository: repo.pulp_href,
            repository_version: `${repo.pulp_href}versions/1/`,
          }),
        ],
        [],
      );

      const found = await repositoryDistributions('deb', repo.pulp_href);

      expect(found).toHaveLength(1);
      expect(found[0].served).toBe(false);
    });
  });
});
