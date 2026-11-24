import { describe, expect, it } from 'vitest';
import {
  type PublicationFact,
  type ServedState,
  type ServingInput,
  isNoteworthy,
  servedPublication,
  servedState,
} from './served-state';

const REPOSITORY = '/pulp/api/v3/repositories/file/file/0190-a/';
const PUBLICATION = '/pulp/api/v3/publications/file/file/0190-b/';
const VERSION = `${REPOSITORY}versions/1/`;

const NOTHING = {
  repository: null,
  publication: null,
  repository_version: null,
};

// A distribution bound to a repository whose latest version is 2, of a plugin
// that serves from publications, read by a user who may read publications.
function input(overrides: Partial<ServingInput> = {}): ServingInput {
  return {
    servesFromPublication: true,
    canReadPublications: true,
    binding: { repository: REPOSITORY },
    latestVersion: 2,
    publishedVersions: [],
    ...overrides,
  };
}

describe(
  'Unit: the served state, the sequences measured on a server',
  { tags: ['unit'] },
  () => {
    it('is stale when only version 1 is published while version 2 is the latest: the older publication is served, not a 404', () => {
      expect(servedState(input({ publishedVersions: [1] }))).toEqual({
        state: 'stale',
        servedVersion: 1,
        latestVersion: 2,
        fix: 'publish-latest',
      });
    });

    it('is served once version 2 is published too', () => {
      expect(servedState(input({ publishedVersions: [1, 2] }))).toEqual({
        state: 'served',
        fix: null,
      });
    });

    it('is still served when version 1 is published again later: the version number beats the creation time', () => {
      // the publications in the order they were made: 1, 2, then 1 again
      expect(servedState(input({ publishedVersions: [1, 2, 1] }))).toEqual({
        state: 'served',
        fix: null,
      });
    });

    it('falls back to stale with the older version when the publication of version 2 is deleted', () => {
      expect(servedState(input({ publishedVersions: [1] }))).toMatchObject({
        state: 'stale',
        servedVersion: 1,
        latestVersion: 2,
      });
    });

    it('reads as bound to nothing when the publication it was bound to is deleted', () => {
      expect(servedState(input({ binding: NOTHING }))).toEqual({
        state: 'unbound',
        fix: 'edit',
      });
    });

    it('is a 404 with the fix to publish when a repository has no publication at all', () => {
      expect(servedState(input({ publishedVersions: [] }))).toEqual({
        state: 'no-publication',
        fix: 'publish-latest',
      });
    });

    it('is bound to nothing when no binding is set at all', () => {
      expect(servedState(input({ binding: {} }))).toEqual({
        state: 'unbound',
        fix: 'edit',
      });
    });
  },
);

describe('Unit: the served state, every binding', { tags: ['unit'] }, () => {
  it('serves a version-bound distribution that has a publication of exactly that version', () => {
    expect(
      servedState(
        input({
          binding: { repository_version: VERSION },
          boundVersion: 1,
          publishedVersions: [1],
        }),
      ),
    ).toEqual({ state: 'served', fix: null });
  });

  it('is a 404 for a version-bound distribution whose version has no publication, even when another version has one', () => {
    expect(
      servedState(
        input({
          binding: { repository_version: VERSION },
          boundVersion: 1,
          publishedVersions: [2],
        }),
      ),
    ).toEqual({ state: 'no-publication', fix: 'publish-version' });
  });

  it('is never stale for a version-bound distribution: it is pinned on purpose', () => {
    expect(
      servedState(
        input({
          binding: { repository_version: VERSION },
          boundVersion: 1,
          publishedVersions: [1],
          latestVersion: 5,
        }),
      ).state,
    ).toBe('served');
  });

  it('is stale for a distribution bound to the publication of version 1 while version 2 is the latest', () => {
    expect(
      servedState(
        input({ binding: { publication: PUBLICATION }, publicationVersion: 1 }),
      ),
    ).toEqual({
      state: 'stale',
      servedVersion: 1,
      latestVersion: 2,
      fix: 'serve-newest',
    });
  });

  it('serves a distribution bound to the publication of the latest version', () => {
    expect(
      servedState(
        input({ binding: { publication: PUBLICATION }, publicationVersion: 2 }),
      ),
    ).toEqual({ state: 'served', fix: null });
  });

  it('serves a publication-bound distribution whose publication version is not known', () => {
    expect(
      servedState(input({ binding: { publication: PUBLICATION } })).state,
    ).toBe('served');
  });

  it('serves a repository-bound distribution of a repository that has no version number yet, once it has a publication', () => {
    expect(
      servedState(input({ latestVersion: null, publishedVersions: [0] })).state,
    ).toBe('served');
  });
});

describe(
  'Unit: the served state for a user who cannot read publications',
  { tags: ['unit'] },
  () => {
    const blind = { canReadPublications: false, publishedVersions: [] };

    it('cannot tell for a repository-bound distribution, however empty the publication list looks', () => {
      expect(servedState(input(blind))).toEqual({
        state: 'cannot-check',
        reason: 'no-permission',
        fix: null,
      });
    });

    it('cannot tell for a version-bound distribution', () => {
      expect(
        servedState(
          input({
            ...blind,
            binding: { repository_version: VERSION },
            boundVersion: 1,
          }),
        ),
      ).toEqual({ state: 'cannot-check', reason: 'no-permission', fix: null });
    });

    it('says served for a publication-bound distribution: the binding itself names a publication', () => {
      expect(
        servedState(input({ ...blind, binding: { publication: PUBLICATION } })),
      ).toEqual({ state: 'served', fix: null });
    });

    it('never says stale, whatever versions it was handed', () => {
      expect(
        servedState(
          input({
            ...blind,
            binding: { publication: PUBLICATION },
            publicationVersion: 1,
          }),
        ).state,
      ).toBe('served');
    });

    it('still says bound to nothing: the distribution itself shows it', () => {
      expect(servedState(input({ ...blind, binding: NOTHING })).state).toBe(
        'unbound',
      );
    });
  },
);

describe(
  'Unit: the served state when there are too many publications',
  { tags: ['unit'] },
  () => {
    it('cannot check a repository-bound distribution', () => {
      expect(servedState(input({ indexOverBound: true }))).toEqual({
        state: 'cannot-check',
        reason: 'too-many',
        fix: null,
      });
    });

    it('cannot check a version-bound distribution', () => {
      expect(
        servedState(
          input({
            indexOverBound: true,
            binding: { repository_version: VERSION },
            boundVersion: 1,
          }),
        ),
      ).toMatchObject({ state: 'cannot-check', reason: 'too-many' });
    });

    it('prefers the missing permission as the reason when both hold', () => {
      expect(
        servedState(
          input({ indexOverBound: true, canReadPublications: false }),
        ),
      ).toMatchObject({ reason: 'no-permission' });
    });
  },
);

describe(
  'Unit: the served state of plugins that serve versions directly',
  { tags: ['unit'] },
  () => {
    const direct = { servesFromPublication: false, publishedVersions: [] };

    it('is not applicable for a repository-bound distribution of python, maven, npm, ansible or container', () => {
      expect(servedState(input(direct))).toEqual({
        state: 'not-applicable',
        fix: null,
      });
    });

    it('is not applicable for a version-bound distribution', () => {
      expect(
        servedState(
          input({
            ...direct,
            binding: { repository_version: VERSION },
            boundVersion: 1,
          }),
        ).state,
      ).toBe('not-applicable');
    });

    it('is not applicable for a user who cannot read publications either, never cannot-check', () => {
      expect(
        servedState(input({ ...direct, canReadPublications: false })).state,
      ).toBe('not-applicable');
    });

    it('is not applicable for a distribution bound to nothing: a pull-through distribution has a remote and no repository', () => {
      expect(servedState(input({ ...direct, binding: NOTHING })).state).toBe(
        'not-applicable',
      );
    });

    it('notes that a python distribution bound to a publication is bound to a deprecated one', () => {
      expect(
        servedState(
          input({ ...direct, binding: { publication: PUBLICATION } }),
        ),
      ).toEqual({
        state: 'not-applicable',
        note: 'deprecated-publication',
        fix: null,
      });
    });

    it('gives a python distribution bound to the repository no note', () => {
      expect(servedState(input(direct))).not.toHaveProperty('note');
    });
  },
);

describe(
  'Unit: the served state of a checkpoint distribution',
  { tags: ['unit'] },
  () => {
    it('is not applicable: it serves by timestamp, not by the newest publication', () => {
      expect(
        servedState(input({ checkpoint: true, publishedVersions: [1] })),
      ).toEqual({ state: 'not-applicable', fix: null });
    });

    it('is not applicable for a user who cannot read publications either', () => {
      expect(
        servedState(input({ checkpoint: true, canReadPublications: false }))
          .state,
      ).toBe('not-applicable');
    });

    it('is still bound to nothing when it is bound to nothing', () => {
      expect(
        servedState(input({ checkpoint: true, binding: NOTHING })).state,
      ).toBe('unbound');
    });
  },
);

describe('Unit: which states are worth drawing', { tags: ['unit'] }, () => {
  const of = (state: ServedState['state'], note?: 'deprecated-publication') =>
    isNoteworthy({ state, note, fix: null });

  it('draws every warning, an unbound state, and a state that cannot be checked', () => {
    for (const state of [
      'stale',
      'no-publication',
      'unbound',
      'cannot-check',
    ] as const) {
      expect(of(state)).toBe(true);
    }
  });

  it('draws nothing for a served distribution or one the rules do not apply to', () => {
    expect(of('served')).toBe(false);
    expect(of('not-applicable')).toBe(false);
  });

  it('draws the note of a distribution the rules do not apply to', () => {
    expect(of('not-applicable', 'deprecated-publication')).toBe(true);
  });
});

describe(
  'Unit: the publication a distribution serves',
  { tags: ['unit'] },
  () => {
    const fact = (
      id: string,
      version: number,
      created: string,
    ): PublicationFact => ({
      pulp_href: `${PUBLICATION}${id}/`,
      repository_version: `${REPOSITORY}versions/${version}/`,
      version,
      created,
    });
    const v1 = fact('a', 1, '2000-01-03T00:00:00Z');
    const v2 = fact('b', 2, '2000-01-01T00:00:00Z');
    const v2later = fact('c', 2, '2000-01-02T00:00:00Z');

    it('is the newest publication of the highest version for a repository-bound distribution, whatever the creation order', () => {
      expect(
        servedPublication({ repository: REPOSITORY }, [v1, v2, v2later]),
      ).toBe(v2later);
    });

    it('is the publication itself for a publication-bound distribution, and none once it is gone', () => {
      expect(servedPublication({ publication: v1.pulp_href }, [v1, v2])).toBe(
        v1,
      );
      expect(servedPublication({ publication: v1.pulp_href }, [v2])).toBeNull();
    });

    it('is the newest publication of the exact version for a version-bound distribution', () => {
      expect(
        servedPublication({ repository_version: v2.repository_version }, [
          v1,
          v2,
          v2later,
        ]),
      ).toBe(v2later);
      expect(
        servedPublication({ repository_version: `${REPOSITORY}versions/3/` }, [
          v1,
        ]),
      ).toBeNull();
    });

    it('is none for a distribution bound to nothing', () => {
      expect(servedPublication(NOTHING, [v1, v2])).toBeNull();
    });
  },
);
