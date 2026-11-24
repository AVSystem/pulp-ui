import { describe, expect, it } from 'vitest';
import { type ProtectionFacts, protectedVersions } from './protected-versions';

// The versions of a repository the server refuses to delete, told before the
// user tries: a version a distribution is bound to, a version whose publication
// a distribution is bound to, the version a repository-bound distribution
// serves, and the only version that is left.

const REPOSITORY = '/pulp/api/v3/repositories/file/file/0192/';
const version = (number: number) => `${REPOSITORY}versions/${number}/`;
const PUBLICATION = '/pulp/api/v3/publications/file/file/0001/';

const facts = (overrides: Partial<ProtectionFacts> = {}): ProtectionFacts => ({
  versions: [0, 1, 2, 3],
  totalVersions: 4,
  distributions: [],
  publicationVersions: new Map(),
  publishedVersions: [],
  latestVersion: 3,
  servesFromPublication: true,
  ...overrides,
});

describe(
  'Unit: the repository versions that cannot be deleted',
  { tags: ['unit'] },
  () => {
    it('protects nothing when no distribution serves the repository and several versions exist', () => {
      expect(protectedVersions(facts()).size).toBe(0);
    });

    it('protects the version a distribution is bound to, naming the distribution', () => {
      const result = protectedVersions(
        facts({
          distributions: [
            { name: 'pinned', repository_version: version(1) },
            { name: 'also-pinned', repository_version: version(1) },
          ],
        }),
      );

      expect([...result.keys()]).toEqual([1]);
      expect(result.get(1)).toEqual([
        { kind: 'version-bound', distributions: ['pinned', 'also-pinned'] },
      ]);
    });

    it('protects the version of the publication a distribution is bound to', () => {
      const result = protectedVersions(
        facts({
          distributions: [{ name: 'by-publication', publication: PUBLICATION }],
          publicationVersions: new Map([[PUBLICATION, 2]]),
        }),
      );

      expect([...result.keys()]).toEqual([2]);
      expect(result.get(2)).toEqual([
        { kind: 'publication-bound', distributions: ['by-publication'] },
      ]);
    });

    it('does not guess for a publication whose version is not known', () => {
      expect(
        protectedVersions(
          facts({
            distributions: [{ name: 'x', publication: PUBLICATION }],
            publicationVersions: new Map(),
          }),
        ).size,
      ).toBe(0);
      expect(
        protectedVersions(
          facts({
            distributions: [{ name: 'x', publication: PUBLICATION }],
            publicationVersions: new Map([[PUBLICATION, null]]),
          }),
        ).size,
      ).toBe(0);
    });

    it('protects the highest published version for a repository-bound distribution of a plugin that serves publications, whatever the latest version is', () => {
      const result = protectedVersions(
        facts({
          distributions: [{ name: 'live', repository: REPOSITORY }],
          publishedVersions: [0, 2, 1],
          latestVersion: 3,
        }),
      );

      expect([...result.keys()]).toEqual([2]);
      expect(result.get(2)).toEqual([
        { kind: 'serves-published', distributions: ['live'] },
      ]);
    });

    it('protects nothing for a repository-bound distribution when the publications are not known', () => {
      expect(
        protectedVersions(
          facts({
            distributions: [{ name: 'live', repository: REPOSITORY }],
            publishedVersions: null,
          }),
        ).size,
      ).toBe(0);
    });

    it('protects nothing for a repository-bound distribution of a repository that has no publication', () => {
      expect(
        protectedVersions(
          facts({
            distributions: [{ name: 'live', repository: REPOSITORY }],
            publishedVersions: [],
          }),
        ).size,
      ).toBe(0);
    });

    it('protects the latest version for a repository-bound distribution of a plugin that serves versions directly', () => {
      const result = protectedVersions(
        facts({
          distributions: [{ name: 'live', repository: REPOSITORY }],
          servesFromPublication: false,
          publishedVersions: null,
          latestVersion: 3,
        }),
      );

      expect([...result.keys()]).toEqual([3]);
      expect(result.get(3)).toEqual([
        { kind: 'serves-latest', distributions: ['live'] },
      ]);
    });

    it('leaves a checkpoint distribution out of the repository rule, because it serves by time', () => {
      expect(
        protectedVersions(
          facts({
            distributions: [
              { name: 'by-time', repository: REPOSITORY, checkpoint: true },
            ],
            publishedVersions: [1],
          }),
        ).size,
      ).toBe(0);
    });

    it('protects every version when only one remains', () => {
      const result = protectedVersions(
        facts({ versions: [2], totalVersions: 1 }),
      );

      expect(result.get(2)).toEqual([{ kind: 'only-version' }]);
    });

    it('lists every reason that applies to one version', () => {
      const result = protectedVersions(
        facts({
          distributions: [
            { name: 'pinned', repository_version: version(2) },
            { name: 'live', repository: REPOSITORY },
          ],
          publishedVersions: [2],
        }),
      );

      expect(result.get(2)?.map(({ kind }) => kind)).toEqual([
        'version-bound',
        'serves-published',
      ]);
    });

    it('only answers for the versions asked about', () => {
      const result = protectedVersions(
        facts({
          versions: [0],
          distributions: [{ name: 'pinned', repository_version: version(1) }],
        }),
      );

      expect(result.size).toBe(0);
    });
  },
);
