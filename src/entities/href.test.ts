import { describe, expect, it } from 'vitest';
import { pulpHrefSchema } from './href';

describe('Unit: pulpHrefSchema', { tags: ['unit'] }, () => {
  it.each([
    '/pulp/api/v3/users/1/',
    '/pulp/api/v3/repositories/file/file/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/',
    '/pulp/api/v3/groups/12/roles/',
  ])('accepts the relative path %s', (value) => {
    expect(pulpHrefSchema.parse(value)).toBe(value);
  });

  it.each([
    ['a protocol-relative value', '//host/pulp/api/v3/users/1/'],
    [
      'a protocol-relative value with a backslash',
      '/\\host/pulp/api/v3/users/1/',
    ],
    ['an absolute URL', 'https://host.example/pulp/api/v3/users/1/'],
    ['a scheme-less host', 'host.example/pulp/api/v3/users/1/'],
    ['a path without a leading slash', 'pulp/api/v3/users/1/'],
    ['an empty string', ''],
    ['a value with a space', '/pulp/api/v3/users/ 1/'],
    ['a value with a tab', '/pulp/api/v3/users/\t1/'],
    ['a value with a line break', '/pulp/api/v3/users/1/\n'],
    ['a value with a control character', '/pulp/api/v3/users/\u00001/'],
  ])('rejects %s', (_label, value) => {
    expect(pulpHrefSchema.safeParse(value).success).toBe(false);
  });

  it.each([null, undefined, 4, {}])('rejects %j as not a string', (value) => {
    expect(pulpHrefSchema.safeParse(value).success).toBe(false);
  });
});
