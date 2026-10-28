import { describe, expect, it } from 'vitest';
import {
  SERVES_FROM_PUBLICATION,
  distributionUrl,
  repositoryOfVersion,
  servedState,
} from './distribution-serving';

describe('SERVES_FROM_PUBLICATION', () => {
  it('lists which plugins need a publication to serve', () => {
    expect(SERVES_FROM_PUBLICATION).toEqual({
      ansible: false,
      deb: true,
      file: true,
      rpm: true,
    });
  });
});

describe('distributionUrl', () => {
  it('returns base_url when present', () => {
    expect(distributionUrl({ base_url: 'http://h/pulp/content/a/' })).toBe(
      'http://h/pulp/content/a/',
    );
  });

  it('falls back to client_url when base_url is absent', () => {
    expect(
      distributionUrl({
        base_url: null,
        client_url: 'http://h/pulp_ansible/galaxy/a/',
      }),
    ).toBe('http://h/pulp_ansible/galaxy/a/');
  });

  it('returns null when the server gave no URL', () => {
    expect(distributionUrl({})).toBeNull();
  });
});

describe('servedState', () => {
  const version1 = [{ pulp_href: 'P', repository_version: 'R/versions/1/' }];

  it('is served for a plugin that does not serve from publications', () => {
    expect(servedState({ repository: 'R' }, false, [])).toBe('served');
  });

  it('is served for a publication-bound distribution', () => {
    expect(servedState({ publication: 'P' }, true, [])).toBe('served');
  });

  it('is not served for a repository-bound distribution without publications', () => {
    expect(servedState({ repository: 'R' }, true, [])).toBe('not-served');
  });

  it('is served for a repository-bound distribution with a publication', () => {
    expect(servedState({ repository: 'R' }, true, version1)).toBe('served');
  });

  it('is not served for a version-bound distribution whose version has no publication', () => {
    expect(
      servedState({ repository_version: 'R/versions/2/' }, true, version1),
    ).toBe('not-served');
  });

  it('is served for a version-bound distribution whose version has a publication', () => {
    expect(
      servedState({ repository_version: 'R/versions/2/' }, true, [
        ...version1,
        { pulp_href: 'Q', repository_version: 'R/versions/2/' },
      ]),
    ).toBe('served');
  });

  it('is not served for a distribution bound to nothing', () => {
    expect(servedState({}, true, version1)).toBe('not-served');
  });
});

describe('repositoryOfVersion', () => {
  it('cuts the trailing versions segment', () => {
    expect(
      repositoryOfVersion('/pulp/api/v3/repositories/deb/apt/0a/versions/3/'),
    ).toBe('/pulp/api/v3/repositories/deb/apt/0a/');
  });

  it('returns null for no version', () => {
    expect(repositoryOfVersion(null)).toBeNull();
  });
});
