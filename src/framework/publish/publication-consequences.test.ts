import { describe, expect, it } from 'vitest';
import {
  type ConsequenceDistribution,
  consequencesOfDelete,
  publicationServedBy,
} from './publication-consequences';

const REPOSITORY = '/pulp/api/v3/repositories/file/file/0190-a/';
const versionHref = (number: number) => `${REPOSITORY}versions/${number}/`;
const href = (id: string) => `/pulp/api/v3/publications/file/file/${id}/`;

function publicationOf(id: string, version: number, created: string) {
  return {
    pulp_href: href(id),
    repository: REPOSITORY,
    repository_version: versionHref(version),
    pulp_created: created,
  };
}

function distributionOf(
  name: string,
  binding: Partial<ConsequenceDistribution>,
): ConsequenceDistribution {
  return {
    name,
    pulp_href: `/pulp/api/v3/distributions/file/file/${name}/`,
    repository: null,
    publication: null,
    repository_version: null,
    ...binding,
  };
}

const V1 = publicationOf('v1', 1, '2000-01-01T00:00:00Z');
const V2 = publicationOf('v2', 2, '2000-01-02T00:00:00Z');

describe(
  'Unit: what deleting a publication does to the distributions',
  { tags: ['unit'] },
  () => {
    it('leaves a repository-bound distribution serving nothing when the only publication goes', () => {
      const bound = distributionOf('bound', { repository: REPOSITORY });

      expect(consequencesOfDelete(V1, [V1], [bound])).toEqual([
        { distribution: bound, after: { kind: 'nothing' } },
      ]);
    });

    it('lets a repository-bound distribution fall back to the older version when the newest publication goes', () => {
      const bound = distributionOf('bound', { repository: REPOSITORY });

      expect(consequencesOfDelete(V2, [V1, V2], [bound])).toEqual([
        { distribution: bound, after: { kind: 'version', version: 1 } },
      ]);
    });

    it('does not list a repository-bound distribution when an older publication goes', () => {
      const bound = distributionOf('bound', { repository: REPOSITORY });

      expect(consequencesOfDelete(V1, [V1, V2], [bound])).toEqual([]);
    });

    it('leaves a publication-bound distribution serving nothing even when other publications exist', () => {
      const pinned = distributionOf('pinned', { publication: V2.pulp_href });
      const other = distributionOf('other', { publication: V1.pulp_href });

      expect(consequencesOfDelete(V2, [V1, V2], [pinned, other])).toEqual([
        { distribution: pinned, after: { kind: 'nothing' } },
      ]);
    });

    it('serves the newest publication of the highest version, whatever the creation order', () => {
      const bound = distributionOf('bound', { repository: REPOSITORY });
      const later = publicationOf('later', 1, '2000-02-01T00:00:00Z');

      expect(publicationServedBy(bound, [V2, V1, later])?.pulp_href).toBe(
        V2.pulp_href,
      );
      const twin = publicationOf('twin', 2, '2000-03-01T00:00:00Z');
      expect(publicationServedBy(bound, [V2, V1, twin])?.pulp_href).toBe(
        twin.pulp_href,
      );
    });

    it('falls back to an older publication of the same version when the newest of it goes', () => {
      const twin = publicationOf('twin', 2, '2000-03-01T00:00:00Z');
      const bound = distributionOf('bound', { repository: REPOSITORY });
      const versioned = distributionOf('versioned', {
        repository_version: versionHref(2),
      });

      expect(
        consequencesOfDelete(twin, [V1, V2, twin], [bound, versioned]),
      ).toEqual([
        { distribution: bound, after: { kind: 'version', version: 2 } },
        { distribution: versioned, after: { kind: 'version', version: 2 } },
      ]);
    });

    it('leaves a version-bound distribution serving nothing when the only publication of its version goes', () => {
      const versioned = distributionOf('versioned', {
        repository_version: versionHref(2),
      });

      expect(consequencesOfDelete(V2, [V1, V2], [versioned])).toEqual([
        { distribution: versioned, after: { kind: 'nothing' } },
      ]);
    });

    it('ignores a checkpoint distribution and one bound to nothing', () => {
      const checkpoint = distributionOf('checkpoint', {
        repository: REPOSITORY,
        checkpoint: true,
      });
      const unbound = distributionOf('unbound', {});

      expect(consequencesOfDelete(V1, [V1], [checkpoint, unbound])).toEqual([]);
    });

    it('names the publication a distribution really serves, none for an unbound one', () => {
      expect(
        publicationServedBy(distributionOf('unbound', {}), [V1, V2]),
      ).toBeNull();
      expect(
        publicationServedBy(
          distributionOf('pinned', { publication: V1.pulp_href }),
          [V1, V2],
        )?.pulp_href,
      ).toBe(V1.pulp_href);
    });
  },
);
