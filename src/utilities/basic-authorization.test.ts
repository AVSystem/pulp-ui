import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { basicAuthorization } from './basic-authorization';

describe('basicAuthorization', () => {
  it('encodes ASCII credentials', () => {
    expect(basicAuthorization('admin', 'password')).toBe(
      'Basic YWRtaW46cGFzc3dvcmQ=',
    );
  });

  it('encodes empty credentials as a bare colon', () => {
    expect(basicAuthorization('', '')).toBe('Basic Og==');
  });

  it('encodes non-Latin-1 names and passwords as UTF-8 without throwing', () => {
    const username = '\u017c\u00f3\u0142w';
    const password = 'p\u0105ss:word';
    const expected = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

    expect(() => basicAuthorization(username, password)).not.toThrow();
    expect(basicAuthorization(username, password)).toBe(expected);
  });
});

// The Basic header carries the password, so it is built for the sign-in
// request and nowhere else: only the sign-in request builders (the login API
// module and the login entity codec) may import the builder, no module may
// encode a Basic header itself, and nothing about it is ever stored.
describe('the single place that builds the Basic header', () => {
  const root = resolve(import.meta.dirname, '..');
  const only = [
    'api/pulp-login.ts',
    'entities/core/login/model.ts',
    'utilities/basic-authorization.test.ts',
  ];

  const sources = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return sources(path);
      }
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });

  const named = (pattern: RegExp) =>
    sources(root)
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file))
      .sort();

  it("is imported only by the sign-in request builders and the builder's own test", () => {
    const importers = named(
      /(?:from|import\(|require\()\s*['"][^'"]*basic-authorization['"]/,
    ).filter((file) => file !== 'utilities/basic-authorization.ts');

    expect(importers).toEqual([...only].sort());
  });

  it('is not built by hand anywhere else', () => {
    const builders = named(/\bbtoa\(|['"`]Basic\s/).filter(
      (file) => !/\.test\.tsx?$/.test(file),
    );

    expect(builders).toEqual(['utilities/basic-authorization.ts'].sort());
  });
});
