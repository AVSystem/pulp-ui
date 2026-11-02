import { describe, expect, it } from 'vitest';
import {
  basePathAncestors,
  basePathProblem,
  isUnderBasePath,
  reservedPrefixFor,
  sanitizeBasePath,
} from './base-path-rules';

describe('sanitizeBasePath', () => {
  it('keeps allowed characters', () => {
    expect(sanitizeBasePath('deb-ragnarok')).toBe('deb-ragnarok');
  });

  it('keeps a version number with its dot', () => {
    expect(sanitizeBasePath('tools-1.0')).toBe('tools-1.0');
  });

  it('keeps every character the server accepts', () => {
    expect(sanitizeBasePath('a+b~c@d_e')).toBe('a+b~c@d_e');
  });

  it('keeps non-ASCII letters', () => {
    expect(sanitizeBasePath('za\u017c\u00f3\u0142\u0107')).toBe(
      'za\u017c\u00f3\u0142\u0107',
    );
  });

  it('replaces a space with an underscore', () => {
    expect(sanitizeBasePath('My Repo')).toBe('My_Repo');
  });

  it('replaces only the forbidden characters of a name and keeps the dot', () => {
    expect(sanitizeBasePath('tools 1.0?')).toBe('tools_1.0_');
  });

  it('replaces a hash, a tab and a line break', () => {
    expect(sanitizeBasePath('a#b\tc\nd')).toBe('a_b_c_d');
  });

  it('collapses repeated slashes and strips leading and trailing ones', () => {
    expect(sanitizeBasePath('/a//b/')).toBe('a/b');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeBasePath('')).toBe('');
  });
});

describe('basePathProblem', () => {
  it.each([
    'tools-1.0',
    'a+b',
    'a~b',
    'user@x',
    'za\u017c\u00f3\u0142\u0107',
    'deep/a.b/c',
    '.hidden',
    'a..b',
    'deb/x',
  ])('accepts %s', (path) => {
    expect(basePathProblem(path)).toBeNull();
  });

  it('reports an empty path', () => {
    expect(basePathProblem('')).toBe('empty');
  });

  it.each(['/a', 'a/', 'a//b', '/'])(
    'reports a misplaced slash in %j',
    (path) => {
      expect(basePathProblem(path)).toBe('slash');
    },
  );

  it.each(['a b', 'a\tb', 'a\nb', 'a?b', 'a#b'])(
    'reports a whitespace or reserved character in %j',
    (path) => {
      expect(basePathProblem(path)).toBe('characters');
    },
  );

  it.each(['.', '..', './x', 'x/..', 'a/./b', 'a/../b'])(
    'reports a dot segment in %j',
    (path) => {
      expect(basePathProblem(path)).toBe('dots');
    },
  );
});

describe('basePathAncestors', () => {
  it('lists every ancestor and the path itself', () => {
    expect(basePathAncestors('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('lists a single segment once', () => {
    expect(basePathAncestors('a')).toEqual(['a']);
  });

  it('lists nothing for an empty path', () => {
    expect(basePathAncestors('')).toEqual([]);
  });
});

describe('isUnderBasePath', () => {
  it('is true for a nested path', () => {
    expect(isUnderBasePath('deb/ragnarok', 'deb')).toBe(true);
  });

  it('is false for a sibling that only shares a prefix', () => {
    expect(isUnderBasePath('debian', 'deb')).toBe(false);
  });

  it('is false for a path under itself', () => {
    expect(isUnderBasePath('deb', 'deb')).toBe(false);
  });

  it('compares case-sensitively', () => {
    expect(isUnderBasePath('Deb/x', 'deb')).toBe(false);
  });
});

describe('reservedPrefixFor', () => {
  it('matches a path under a prefix configured with a slash', () => {
    expect(reservedPrefixFor('deb/x', ['deb/', 'rpm/'])).toBe('deb/');
  });

  it('matches the bare prefix itself', () => {
    expect(reservedPrefixFor('deb', ['deb/'])).toBe('deb/');
  });

  it('matches a prefix configured without a slash and returns it as configured', () => {
    expect(reservedPrefixFor('rpm/a/b', ['deb', 'rpm'])).toBe('rpm');
  });

  it('does not match on a partial segment', () => {
    expect(reservedPrefixFor('debian/x', ['deb/'])).toBeNull();
  });

  it('compares case-sensitively', () => {
    expect(reservedPrefixFor('Deb/x', ['deb/'])).toBeNull();
  });

  it('returns null for an empty prefix list', () => {
    expect(reservedPrefixFor('x', [])).toBeNull();
  });

  it('returns null when no prefix list is configured', () => {
    expect(reservedPrefixFor('x', undefined)).toBeNull();
  });

  it('ignores empty prefixes', () => {
    expect(reservedPrefixFor('x', [''])).toBeNull();
  });
});
