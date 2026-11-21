import { describe, expect, it } from 'vitest';
import {
  hrefsOutsideCollection,
  recordApiRequests,
} from 'src/test-utils/api-requests';
import { GroupRoleAPI } from './group-role';
import { TaskAPI } from './task';
import { UserRoleAPI } from './user-role';

const TASK_ID = '00000000-0000-4000-8000-0000000000bb';

// Each member that addressed an object by its id, called with the object's
// address, the collection it must stay in, and the request it has always made
// for that id.
const MEMBERS: {
  name: string;
  collection: string;
  href: string;
  call: (href: string) => Promise<unknown>;
  method: string;
  path: string;
  search?: string;
}[] = [
  {
    name: 'UserRoleAPI.listRoles',
    collection: 'users/',
    href: '/pulp/api/v3/users/7/',
    call: (href) => UserRoleAPI.listRoles(href, { content_object: 'null' }),
    method: 'GET',
    path: '/pulp/api/v3/users/7/roles/',
    search: 'content_object=null',
  },
  {
    name: 'GroupRoleAPI.listRoles',
    collection: 'groups/',
    href: '/pulp/api/v3/groups/3/',
    call: (href) => GroupRoleAPI.listRoles(href, { content_object: 'null' }),
    method: 'GET',
    path: '/pulp/api/v3/groups/3/roles/',
    search: 'content_object=null',
  },
  {
    name: 'TaskAPI.get',
    collection: 'tasks/',
    href: `/pulp/api/v3/tasks/${TASK_ID}/`,
    call: (href) => TaskAPI.get(href),
    method: 'GET',
    path: `/pulp/api/v3/tasks/${TASK_ID}/`,
  },
];

describe(
  'Integration: the user, group and task members take the object address',
  { tags: ['integration'] },
  () => {
    it.each(MEMBERS)(
      '$name requests the path it requested for the id',
      async ({ call, href, method, path, search }) => {
        const sent = recordApiRequests();

        await call(href);

        expect(sent).toHaveLength(1);
        expect(sent[0].method).toBe(method);
        expect(sent[0].path).toBe(path);
        if (search) {
          expect(sent[0].search).toContain(search);
        }
      },
    );

    it.each(MEMBERS)(
      '$name accepts the address without its trailing slash',
      async ({ call, href, path }) => {
        const sent = recordApiRequests();

        await call(href.replace(/\/$/, ''));

        expect(sent.map((request) => request.path)).toEqual([path]);
      },
    );

    describe.each(MEMBERS)(
      '$name refuses an address',
      ({ call, collection }) => {
        it.each(hrefsOutsideCollection(collection))(
          'that is not an object of this collection: %j',
          async (href) => {
            const sent = recordApiRequests();

            await expect(call(href)).rejects.toThrow(/does not name/);

            expect(sent).toEqual([]);
          },
        );

        it.each([undefined, null, 7, {}])(
          'that is not text: %j',
          async (href) => {
            const sent = recordApiRequests();

            await expect(call(href as never)).rejects.toThrow(/does not name/);

            expect(sent).toEqual([]);
          },
        );
      },
    );
  },
);
