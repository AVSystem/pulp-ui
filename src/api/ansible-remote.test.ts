import { describe, expect, it } from 'vitest';
import {
  hrefsOutsideCollection,
  recordApiRequests,
} from 'src/test-utils/api-requests';
import { AnsibleRemoteAPI, type AnsibleRemoteType } from './ansible-remote';

const ID = '00000000-0000-4000-8000-0000000000bb';
const COLLECTION = 'remotes/ansible/collection/';
const HREF = `/pulp/api/v3/${COLLECTION}${ID}/`;
const PATH = `/pulp/api/v3/${COLLECTION}${ID}`;

const remote = (overrides: Partial<AnsibleRemoteType> = {}) =>
  ({
    name: 'remote',
    url: 'https://example.invalid/',
    ...overrides,
  }) as AnsibleRemoteType;

// Each member that addressed a remote by its id, called with the remote's
// address, and the request it has always made for that id.
const MEMBERS: {
  name: string;
  call: (href: string) => Promise<unknown>;
  method: string;
  path: string;
  body?: unknown;
}[] = [
  {
    name: 'addRole',
    call: (href) => AnsibleRemoteAPI.addRole(href, { role: 'r' }),
    method: 'POST',
    path: `${PATH}/add_role/`,
    body: { role: 'r' },
  },
  {
    name: 'delete',
    call: (href) => AnsibleRemoteAPI.delete(href),
    method: 'DELETE',
    path: `${PATH}/`,
  },
  {
    name: 'get',
    call: (href) => AnsibleRemoteAPI.get(href),
    method: 'GET',
    path: `${PATH}/`,
  },
  {
    name: 'listRoles',
    call: (href) => AnsibleRemoteAPI.listRoles(href, { page_size: 100 }),
    method: 'GET',
    path: `${PATH}/list_roles/`,
  },
  {
    name: 'myPermissions',
    call: (href) => AnsibleRemoteAPI.myPermissions(href),
    method: 'GET',
    path: `${PATH}/my_permissions/`,
  },
  {
    name: 'removeRole',
    call: (href) => AnsibleRemoteAPI.removeRole(href, { role: 'r' }),
    method: 'POST',
    path: `${PATH}/remove_role/`,
    body: { role: 'r' },
  },
  {
    name: 'smartUpdate',
    call: (href) =>
      AnsibleRemoteAPI.smartUpdate(
        href,
        remote({ name: 'new', auth_url: 'https://a.invalid/' }),
        remote({ name: 'old', auth_url: 'https://a.invalid/' }),
      ),
    method: 'PUT',
    path: `${PATH}/`,
    // the unchanged auth_url is left out of the update
    body: { name: 'new', url: 'https://example.invalid/' },
  },
];

describe(
  'Integration: the ansible remote members take the remote address',
  { tags: ['integration'] },
  () => {
    it.each(MEMBERS)(
      '$name requests the path it requested for the id',
      async ({ call, method, path, body }) => {
        const sent = recordApiRequests();

        await call(HREF);

        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe(method);
        expect(sent[0].path).toBe(path);
        expect(sent[0].body).toEqual(body);
      },
    );

    describe.each(MEMBERS)('$name refuses an address', ({ call }) => {
      it.each(hrefsOutsideCollection(COLLECTION))(
        'that is not a remote of this API: %j',
        async (href) => {
          const sent = recordApiRequests();

          await expect(call(href)).rejects.toThrow(/does not name/);

          expect(sent).toEqual([]);
        },
      );
    });
  },
);
