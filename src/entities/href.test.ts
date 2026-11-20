import { describe, expect, it } from 'vitest';
import {
  apiPathOfHref,
  pluginOfHref,
  pulpHrefSchema,
  repositoryOfVersion,
  versionNumberOf,
} from './href';

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

const API = '/pulp/api/v3';
const ID = '00000000-0000-4000-8000-0000000000a1';
const REPOSITORY = `${API}/repositories/file/file/${ID}/`;

describe('Unit: versionNumberOf', { tags: ['unit'] }, () => {
  it.each([
    [`${REPOSITORY}versions/3/`, 3],
    [`${REPOSITORY}versions/0/`, 0],
    [`${REPOSITORY}versions/12`, 12],
    [`${API}/repositories/deb/apt/${ID}/versions/7/`, 7],
  ])('reads the number of %s', (href, number) => {
    expect(versionNumberOf(href)).toBe(number);
  });

  it.each([
    ['a repository address', REPOSITORY],
    ['an address with a query', `${REPOSITORY}versions/3/?x=1`],
    ['an address with a fragment', `${REPOSITORY}versions/3/#top`],
    ['a non-numeric segment', `${REPOSITORY}versions/latest/`],
    ['a number with a sign', `${REPOSITORY}versions/-3/`],
    ['a number with leading zeros', `${REPOSITORY}versions/03/`],
    ['a fraction', `${REPOSITORY}versions/3.5/`],
    [
      'a number that is not safe to hold',
      `${REPOSITORY}versions/99999999999999999999/`,
    ],
    ['the list of versions', `${REPOSITORY}versions/`],
    [
      'an address that goes on after the number',
      `${REPOSITORY}versions/3/content/`,
    ],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('answers nothing for %s', (_label, href) => {
    expect(versionNumberOf(href)).toBeNull();
  });
});

describe('Unit: repositoryOfVersion', { tags: ['unit'] }, () => {
  it('gives the repository a version address belongs to', () => {
    expect(repositoryOfVersion(`${REPOSITORY}versions/3/`)).toBe(REPOSITORY);
    expect(repositoryOfVersion(`${REPOSITORY}versions/0`)).toBe(REPOSITORY);
  });

  it.each([
    ['a repository address', REPOSITORY],
    ['an address with a query', `${REPOSITORY}versions/3/?x=1`],
    ['a non-numeric segment', `${REPOSITORY}versions/latest/`],
    [
      'an address that is not a path of this host',
      `https://other.example${REPOSITORY}versions/3/`,
    ],
    ['a version address without a repository', '/versions/3/'],
    ['null', null],
  ])('answers nothing for %s', (_label, href) => {
    expect(repositoryOfVersion(href)).toBeNull();
  });
});

describe('Unit: apiPathOfHref', { tags: ['unit'] }, () => {
  it('gives the path below the API base', () => {
    expect(apiPathOfHref(REPOSITORY)).toBe(`repositories/file/file/${ID}/`);
    expect(apiPathOfHref(`${API}/tasks/${ID}/`)).toBe(`tasks/${ID}/`);
  });

  it.each([
    ['an address outside the API base', `/elsewhere/api/v3/tasks/${ID}/`],
    ['the API base itself', `${API}/`],
    ['an absolute URL', `https://host.example${API}/tasks/${ID}/`],
    ['a protocol-relative value', `//host.example${API}/tasks/${ID}/`],
    ['a dot segment', `${API}/repositories/../status/`],
    ['an encoded dot segment', `${API}/repositories/%2e%2e/status/`],
    ['an encoded slash', `${API}/repositories%2f..%2fstatus/`],
    ['a backslash', `${API}/repositories\\..\\status/`],
    ['a query', `${API}/tasks/${ID}/?x=1`],
    ['a fragment', `${API}/tasks/${ID}/#top`],
    ['a value with a space', `${API}/tasks/ ${ID}/`],
    ['an empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])('answers nothing for %s', (_label, href) => {
    expect(apiPathOfHref(href)).toBeNull();
  });
});

describe('Unit: pluginOfHref', { tags: ['unit'] }, () => {
  it.each([
    [`${API}/repositories/file/file/${ID}/`, 'file'],
    [`${API}/repositories/deb/apt/${ID}/versions/2/`, 'deb'],
    [`${API}/repositories/rpm/rpm/${ID}/`, 'rpm'],
    [`${API}/repositories/python/python/${ID}/versions/1/`, 'python'],
    [`${API}/repositories/ansible/ansible/${ID}/`, 'ansible'],
    [`${API}/remotes/file/file/${ID}/`, 'file'],
    [`${API}/remotes/ansible/collection/${ID}/`, 'ansible'],
    [`${API}/distributions/file/file/${ID}/`, 'file'],
    [`/prefix/api/v3/remotes/deb/apt/${ID}/`, 'deb'],
  ])('reads the plugin of %s', (href, plugin) => {
    expect(pluginOfHref(href)).toBe(plugin);
  });

  it.each([
    undefined,
    null,
    '',
    `${API}/repositories/unknown/thing/${ID}/`,
    `${API}/repositories/constructor/thing/${ID}/`,
    `${API}/tasks/${ID}/`,
    `${API}/groups/1/`,
  ])('answers nothing for %s', (href) => {
    expect(pluginOfHref(href)).toBeUndefined();
  });
});
