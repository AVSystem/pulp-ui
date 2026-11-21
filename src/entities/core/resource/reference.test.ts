import { describe, expect, it } from 'vitest';
import { config } from 'src/ui-config';
import { resourceReference } from './reference';

const ID = '0192e5a1-0000-7000-8000-000000000001';
const BASE = config.API_BASE_PATH;

describe('the resources a task reserved', { tags: ['unit'] }, () => {
  it('shows an address as an object to read', () => {
    expect(resourceReference(`${BASE}repositories/file/file/${ID}/`)).toEqual({
      kind: 'read',
      href: `${BASE}repositories/file/file/${ID}/`,
      plugin: 'file',
      type: 'filerepository',
    });
  });

  it('shows a deb address as an object to read', () => {
    expect(resourceReference(`${BASE}repositories/deb/apt/${ID}/`)).toEqual({
      kind: 'read',
      href: `${BASE}repositories/deb/apt/${ID}/`,
      plugin: 'deb',
      type: 'aptrepository',
    });
  });

  it('shows a PRN as an object to read, with or without the shared prefix', () => {
    const expected = {
      kind: 'read',
      href: `${BASE}remotes/rpm/rpm/${ID}/`,
      plugin: 'rpm',
      type: 'rpmremote',
    };
    expect(resourceReference(`prn:rpm.rpmremote:${ID}`)).toEqual(expected);
    expect(resourceReference(`shared:prn:rpm.rpmremote:${ID}`)).toEqual(
      expected,
    );
  });

  it('shows a domain as text and never reads it', () => {
    expect(resourceReference(`pdrn:${ID}:label`)).toEqual({
      kind: 'text',
      type: 'Domain Resource',
      name: 'label',
    });
    expect(resourceReference(`prn:core.domain:${ID}`)).toEqual({
      kind: 'text',
      type: 'Domain Resource',
      name: `prn:core.domain:${ID}`,
    });
  });

  it.each([
    'prn:file.filerepository:../../status',
    'prn:file.filerepository:a/b',
    `${BASE}constructor/${ID}/`,
    'prn:nothing.here:' + ID,
    'prn:',
    'unrelated text',
  ])('shows nothing for %j', (record) => {
    expect(resourceReference(record)).toBeNull();
  });
});
