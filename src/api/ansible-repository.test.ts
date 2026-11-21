import { describe, expect, it } from 'vitest';
import {
  hrefsOutsideCollection,
  recordApiRequests,
} from 'src/test-utils/api-requests';
import { AnsibleRepositoryAPI } from './ansible-repository';

const ID = '00000000-0000-4000-8000-0000000000aa';
const COLLECTION = 'repositories/ansible/ansible/';
const HREF = `/pulp/api/v3/${COLLECTION}${ID}/`;
const VERSION_HREF = `${HREF}versions/2/`;
const CONTENT_HREF = '/pulp/api/v3/content/ansible/collection_versions/1/';

// Each member that addressed a repository by its id, called with the
// repository's address, and the request it has always made for that id.
const MEMBERS: {
  name: string;
  call: (href: string) => Promise<unknown>;
  method: string;
  path: string;
  body?: unknown;
}[] = [
  {
    name: 'addContent',
    call: (href) => AnsibleRepositoryAPI.addContent(href, [CONTENT_HREF]),
    method: 'POST',
    path: `/pulp/api/v3/${COLLECTION}${ID}/modify/`,
    body: { add_content_units: [CONTENT_HREF] },
  },
  {
    name: 'addRole',
    call: (href) => AnsibleRepositoryAPI.addRole(href, { role: 'r' }),
    method: 'POST',
    path: `/pulp/api/v3/${COLLECTION}${ID}/add_role/`,
    body: { role: 'r' },
  },
  {
    name: 'delete',
    call: (href) => AnsibleRepositoryAPI.delete(href),
    method: 'DELETE',
    path: `/pulp/api/v3/${COLLECTION}${ID}/`,
  },
  {
    name: 'listRoles',
    call: (href) => AnsibleRepositoryAPI.listRoles(href, { page_size: 100 }),
    method: 'GET',
    path: `/pulp/api/v3/${COLLECTION}${ID}/list_roles/`,
  },
  {
    name: 'listVersions',
    call: (href) => AnsibleRepositoryAPI.listVersions(href, { number: 2 }),
    method: 'GET',
    path: `/pulp/api/v3/${COLLECTION}${ID}/versions/`,
  },
  {
    name: 'myPermissions',
    call: (href) => AnsibleRepositoryAPI.myPermissions(href),
    method: 'GET',
    path: `/pulp/api/v3/${COLLECTION}${ID}/my_permissions/`,
  },
  {
    name: 'patch',
    call: (href) => AnsibleRepositoryAPI.patch(href, { name: 'n' }),
    method: 'PATCH',
    path: `/pulp/api/v3/${COLLECTION}${ID}/`,
    body: { name: 'n' },
  },
  {
    name: 'removeContent',
    call: (href) => AnsibleRepositoryAPI.removeContent(href, CONTENT_HREF),
    method: 'POST',
    path: `/pulp/api/v3/${COLLECTION}${ID}/modify/`,
    body: { remove_content_units: [CONTENT_HREF] },
  },
  {
    name: 'removeRole',
    call: (href) => AnsibleRepositoryAPI.removeRole(href, { role: 'r' }),
    method: 'POST',
    path: `/pulp/api/v3/${COLLECTION}${ID}/remove_role/`,
    body: { role: 'r' },
  },
  {
    name: 'revert',
    call: (href) => AnsibleRepositoryAPI.revert(href, VERSION_HREF),
    method: 'POST',
    path: `/pulp/api/v3/${COLLECTION}${ID}/modify/`,
    body: { base_version: VERSION_HREF },
  },
  {
    name: 'sync',
    call: (href) => AnsibleRepositoryAPI.sync(href, { mirror: true }),
    method: 'POST',
    path: `/pulp/api/v3/${COLLECTION}${ID}/sync/`,
    body: { mirror: true },
  },
];

describe(
  'Integration: the ansible repository members take the repository address',
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

    it('an address without its trailing slash names the same object', async () => {
      const sent = recordApiRequests();

      await AnsibleRepositoryAPI.sync(HREF.slice(0, -1), {});

      expect(sent.map(({ path }) => path)).toEqual([
        `/pulp/api/v3/${COLLECTION}${ID}/sync/`,
      ]);
    });

    describe.each(MEMBERS)('$name refuses an address', ({ call }) => {
      it.each(hrefsOutsideCollection(COLLECTION))(
        'that is not a repository of this API: %j',
        async (href) => {
          const sent = recordApiRequests();

          await expect(call(href)).rejects.toThrow(/does not name/);

          expect(sent).toEqual([]);
        },
      );

      it.each([undefined, null, 42])(
        'that is not a string: %j',
        async (href) => {
          const sent = recordApiRequests();

          await expect(call(href as unknown as string)).rejects.toThrow(
            /does not name/,
          );

          expect(sent).toEqual([]);
        },
      );
    });
  },
);
