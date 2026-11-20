// @vitest-environment node
// Tests of the parameter resolvers of the crawler that need no server.
import { describe, expect, it } from 'vitest';
import { namedListOf, versionNumberIn } from './params.ts';

describe('namedListOf', () => {
  it('finds the list of the plugin a repository or remote address belongs to', () => {
    expect(namedListOf('/file/repositories/:name/versions/:number')).toBe(
      'repositories/file/file/',
    );
    expect(namedListOf('/rpm/repositories/:name')).toBe(
      'repositories/rpm/rpm/',
    );
    expect(namedListOf('/python/remotes/:name/edit')).toBe(
      'remotes/python/python/',
    );
    expect(namedListOf('/deb/remotes/detail/:name')).toBe('remotes/deb/apt/');
  });

  it('knows no list for anything else', () => {
    expect(namedListOf('/tasks/:task')).toBeNull();
  });
});

describe('versionNumberIn', () => {
  it('reads the number a version address ends in, including 0', () => {
    expect(
      versionNumberIn('/pulp/api/v3/repositories/file/file/abc/versions/12/'),
    ).toBe('12');
    expect(
      versionNumberIn('/pulp/api/v3/repositories/file/file/abc/versions/0/'),
    ).toBe('0');
  });

  it('reads nothing from an address that is not a version', () => {
    expect(
      versionNumberIn('/pulp/api/v3/repositories/file/file/abc/'),
    ).toBeNull();
    expect(versionNumberIn('/pulp/api/v3/x/versions/x/')).toBeNull();
    expect(versionNumberIn(null)).toBeNull();
    expect(versionNumberIn(undefined)).toBeNull();
  });
});
