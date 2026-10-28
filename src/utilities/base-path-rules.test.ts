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

  it('replaces a space with an underscore', () => {
    expect(sanitizeBasePath('My Repo')).toBe('My_Repo');
  });

  it('replaces an emoji with one underscore, not two', () => {
    expect(sanitizeBasePath('repo \ud83d\ude00')).toBe('repo__');
  });

  it('replaces every non-ASCII letter with one underscore', () => {
    expect(sanitizeBasePath('za\u017c\u00f3\u0142\u0107')).toBe('za____');
  });

  it('collapses repeated slashes and strips leading and trailing ones', () => {
    expect(sanitizeBasePath('/a//b/')).toBe('a/b');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeBasePath('')).toBe('');
  });
});

describe('basePathProblem', () => {
  it('reports an empty path', () => {
    expect(basePathProblem('')).toBe('empty');
  });

  it('reports a leading slash', () => {
    expect(basePathProblem('/a')).toBe('slash');
  });

  it('reports a trailing slash', () => {
    expect(basePathProblem('a/')).toBe('slash');
  });

  it('reports a doubled slash', () => {
    expect(basePathProblem('a//b')).toBe('slash');
  });

  it('reports a character outside the allowed set', () => {
    expect(basePathProblem('a b')).toBe('characters');
  });

  it('accepts a nested path', () => {
    expect(basePathProblem('deb/x')).toBeNull();
  });
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
