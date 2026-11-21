import { describe, expect, it } from 'vitest';
import { config } from 'src/ui-config';
import { parsePulpResource, resourceHref } from './prn';

const ID = '0192e5a1-0000-7000-8000-000000000001';
const BASE = config.API_BASE_PATH;

describe('parsing an address of the API', { tags: ['unit'] }, () => {
  it.each([
    ['repositories/file/file', 'file', 'filerepository'],
    ['remotes/rpm/rpm', 'rpm', 'rpmremote'],
    ['distributions/python/pypi', 'python', 'pythondistribution'],
    ['publications/file/file', 'file', 'filepublication'],
    ['repositories/ansible/ansible', 'ansible', 'ansiblerepository'],
    ['tasks', 'core', 'task'],
  ])('names the kind of %s', (collection, plugin, model) => {
    expect(parsePulpResource(`${BASE}${collection}/${ID}/`)).toEqual({
      id: ID,
      plugin,
      model,
      resource_label: undefined,
    });
  });

  it('reads an address without the trailing slash', () => {
    expect(parsePulpResource(`${BASE}tasks/${ID}`)?.model).toBe('task');
  });

  it.each([
    ['repositories/deb/apt', 'aptrepository'],
    ['remotes/deb/apt', 'aptremote'],
    ['distributions/deb/apt', 'aptdistribution'],
    ['publications/deb/apt', 'aptpublication'],
    ['publications/deb/verbatim', 'verbatimpublication'],
  ])(
    'names the deb kind of %s: the segment "deb" is not taken for an id',
    (collection, model) => {
      expect(parsePulpResource(`${BASE}${collection}/${ID}/`)).toMatchObject({
        id: ID,
        plugin: 'deb',
        model,
      });
    },
  );

  it.each(['dead', 'bad', 'face', 'cafe'])(
    'does not drop a collection segment such as "%s" because it looks like hex',
    (segment) => {
      expect(parsePulpResource(`${BASE}content/${segment}/${ID}/`)).toBeNull();
    },
  );

  it.each([
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'valueOf',
  ])('answers null for a "%s" segment instead of throwing', (segment) => {
    expect(parsePulpResource(`${BASE}${segment}/${ID}/`)).toBeNull();
    expect(
      parsePulpResource(`${BASE}repositories/${segment}/${ID}/`),
    ).toBeNull();
    expect(parsePulpResource(`${BASE}${segment}/${segment}/${ID}/`)).toBeNull();
  });

  it.each([
    ['a version', `${BASE}repositories/file/file/${ID}/versions/1/`],
    ['an action', `${BASE}repositories/file/file/${ID}/sync/`],
    ['a query', `${BASE}repositories/file/file/${ID}/?x=1`],
    ['a list', `${BASE}repositories/file/file/`],
    ['no id', `${BASE}repositories/file/file/not-an-id/`],
    ['another base', `/other/api/v3/repositories/file/file/${ID}/`],
    ['an absolute address', `https://example.invalid${BASE}tasks/${ID}/`],
    ['an unknown kind', `${BASE}nothing/here/${ID}/`],
    ['an empty string', ''],
  ])('answers null for %s', (_, value) => {
    expect(parsePulpResource(value)).toBeNull();
  });
});

describe('parsing a PRN', { tags: ['unit'] }, () => {
  it('reads the kind and the id', () => {
    expect(parsePulpResource(`prn:file.filerepository:${ID}`)).toEqual({
      id: ID,
      plugin: 'file',
      model: 'filerepository',
      resource_label: undefined,
    });
    expect(parsePulpResource(`prn:deb.aptrepository:${ID}`)).toMatchObject({
      plugin: 'deb',
      model: 'aptrepository',
    });
  });

  it('reads a domain resource name', () => {
    expect(parsePulpResource(`pdrn:${ID}:shared-label`)).toEqual({
      id: ID,
      plugin: 'core',
      model: 'domain',
      resource_label: 'shared-label',
    });
  });

  it.each([
    'prn:',
    'prn:file',
    'prn:file.filerepository',
    'prn:filerepository:' + ID,
    'prn:.:' + ID,
    'prn:file.filerepository:',
    'prn:file.filerepository:a:b',
    'pdrn:',
    'pdrn:only-an-id',
    'something-else',
    '',
  ])('answers null for the malformed value %j', (value) => {
    expect(parsePulpResource(value)).toBeNull();
  });
});

describe('the address of a resource', { tags: ['unit'] }, () => {
  it('turns a parsed address back into the address', () => {
    for (const href of [
      `${BASE}repositories/file/file/${ID}/`,
      `${BASE}repositories/deb/apt/${ID}/`,
      `${BASE}tasks/${ID}/`,
    ]) {
      const resource = parsePulpResource(href);
      expect(resource && resourceHref(resource)).toBe(href);
    }
  });

  it('turns a PRN into an address', () => {
    const resource = parsePulpResource(`prn:rpm.rpmremote:${ID}`);
    expect(resource && resourceHref(resource)).toBe(
      `${BASE}remotes/rpm/rpm/${ID}/`,
    );
  });

  it('has no address for a kind it does not know', () => {
    expect(
      resourceHref({ id: ID, plugin: 'nothing', model: 'here' }),
    ).toBeNull();
    expect(
      resourceHref({ id: ID, plugin: 'constructor', model: 'constructor' }),
    ).toBeNull();
    expect(
      resourceHref({ id: ID, plugin: '__proto__', model: 'toString' }),
    ).toBeNull();
  });

  it.each(['', '../status', 'a/b', 'a?b', 'a b', '%2e%2e', 'null/..'])(
    'has no address for the id %j: an id is part of a path',
    (id) => {
      expect(
        resourceHref({ id, plugin: 'file', model: 'filerepository' }),
      ).toBeNull();
    },
  );
});
