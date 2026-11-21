import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type IRoleAssignment,
  listOf,
  projectedBy,
  role,
  roleAssignment,
} from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { addAssignments, objectPermissionIndex } from './model';
import { type ObjectPermissions, useObjectPermissions } from './queries';

const API = '/pulp/api/v3';
const REPOSITORIES = `${API}/repositories/file/file`;
const repositoryHref = (id: number) => `${REPOSITORIES}/repository-${id}/`;

const VIEWER = 'file.filerepository_viewer';
const OWNER = 'file.filerepository_owner';
const VIEW = 'file.view_filerepository';
const SYNC = 'file.sync_filerepository';
const DELETE = 'file.delete_filerepository';

const CATALOGUE = [
  role({ name: VIEWER, permissions: [VIEW] }),
  role({ name: OWNER, permissions: [VIEW, SYNC, DELETE] }),
];

describe('Unit: the object-permission index', { tags: ['unit'] }, () => {
  const permissionsOf = new Map([
    [VIEWER, [VIEW]],
    [OWNER, [VIEW, SYNC, DELETE]],
  ]);

  it('answers a permission of an object from the roles held on that object', () => {
    const grants = new Map();
    addAssignments(grants, [
      { role: VIEWER, content_object: repositoryHref(1) },
      { role: OWNER, content_object: repositoryHref(2) },
    ]);
    const can = objectPermissionIndex(grants, permissionsOf);

    expect(can(repositoryHref(1), VIEW)).toBe(true);
    expect(can(repositoryHref(1), SYNC)).toBe(false);
    expect(can(repositoryHref(2), SYNC)).toBe(true);
    expect(can(repositoryHref(3), VIEW)).toBe(false);
  });

  it('adds up the permissions of the roles held on one object, from any source', () => {
    const grants = new Map();
    addAssignments(grants, [
      { role: VIEWER, content_object: repositoryHref(1) },
    ]);
    addAssignments(grants, [
      { role: 'file.filerepository_syncer', content_object: repositoryHref(1) },
    ]);
    const can = objectPermissionIndex(
      grants,
      new Map([
        ...Array.from(permissionsOf),
        ['file.filerepository_syncer', [SYNC]],
      ]),
    );

    expect(can(repositoryHref(1), VIEW)).toBe(true);
    expect(can(repositoryHref(1), SYNC)).toBe(true);
    expect(can(repositoryHref(1), DELETE)).toBe(false);
  });

  it('ignores a role held on no object and a role the catalogue does not know', () => {
    const grants = new Map();
    addAssignments(grants, [
      { role: OWNER, content_object: null },
      { role: OWNER },
      { role: 'unknown.role', content_object: repositoryHref(1) },
    ]);
    const can = objectPermissionIndex(grants, permissionsOf);

    expect(can(repositoryHref(1), VIEW)).toBe(false);
    expect(can(null, VIEW)).toBe(false);
    expect(can(undefined, VIEW)).toBe(false);
    expect(grants.size).toBe(1);
  });
});

// What a test serves: the signed-in user's record, their roles and those of
// their groups, and the catalogue of roles.
interface IAccount {
  isStaff?: boolean;
  own?: IRoleAssignment[];
  groups?: { id: number; rows: IRoleAssignment[] }[];
  catalogue?: ReturnType<typeof role>[];
  recordStatus?: number;
}

function serveAccount({
  isStaff = false,
  own = [],
  groups = [],
  catalogue = CATALOGUE,
  recordStatus = 200,
}: IAccount = {}) {
  const session = { username: 'zoe', pulp_href: `${API}/users/7/` };
  // the roles of a user or a group as the server lists them: `content_object`
  // filters, the `fields` cut, 1000 rows a page
  const rolesOf = (path: string, rows: IRoleAssignment[]) =>
    listOf(path, rows, {
      pageSize: 1000,
      matching: (row, query) =>
        query.get('content_object') !== 'null' || row.content_object === null,
      projected: projectedBy,
    });
  const handlers = [
    http.get(`*${API}/login/`, () => HttpResponse.json(session)),
    http.get(`*${API}/users/7/`, () =>
      recordStatus === 200
        ? HttpResponse.json({
            ...session,
            id: 7,
            is_staff: isStaff,
            groups: groups.map((group) => ({
              name: `group-${group.id}`,
              pulp_href: `${API}/groups/${group.id}/`,
              prn: `prn:auth.group:${group.id}`,
            })),
          })
        : HttpResponse.json({ detail: 'no' }, { status: recordStatus }),
    ),
  ];
  const lists = {
    user: rolesOf(`${API}/users/7/roles/`, own),
    groups: groups.map((group) =>
      rolesOf(`${API}/groups/${group.id}/roles/`, group.rows),
    ),
    catalogue: listOf(`${API}/roles/`, catalogue, {
      pageSize: 1000,
      projected: projectedBy,
    }),
  };
  server.use(
    ...handlers,
    lists.user.handler,
    ...lists.groups.map((list) => list.handler),
    lists.catalogue.handler,
  );

  return lists;
}

// Every request the index makes, as path and query. The global-role
// reads of the permission provider (`content_object=null`) belong to the
// sign-in, not to the index; the reads of the own record are shared with it.
function recordIndexReads() {
  const reads: string[] = [];
  const onStart = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    if (url.searchParams.get('content_object') === 'null') {
      return;
    }
    // the sign-in, the plugin list and the own record are not index reads
    if (
      [`${API}/login/`, `${API}/status/`, `${API}/users/7/`].includes(
        url.pathname,
      )
    ) {
      return;
    }
    reads.push(`${url.pathname}${url.search}`);
  };
  server.events.on('request:start', onStart);
  return {
    reads,
    stop: () => server.events.removeListener('request:start', onStart),
  };
}

let latest: ObjectPermissions;
let asked: number;

// Asks the index about `objects` addresses on every render, as a page of rows
// does, and shows the state.
function Probe({
  objects = [],
  enabled,
}: {
  objects?: string[];
  enabled?: boolean;
}) {
  const permissions = useObjectPermissions({ enabled });
  latest = permissions;
  const allowed = objects.filter((href) => permissions.can(href, SYNC));
  asked += objects.length;
  return (
    <>
      <p>state: {permissions.state}</p>
      <p>allowed: {allowed.length}</p>
    </>
  );
}

const state = (name: string) => screen.findByText(`state: ${name}`);

describe('Integration: useObjectPermissions', { tags: ['integration'] }, () => {
  let recorder: ReturnType<typeof recordIndexReads>;

  beforeEach(() => {
    asked = 0;
    recorder = recordIndexReads();
  });

  afterEach(() => {
    recorder.stop();
  });

  it('knows what the user may do on an object from their own roles and those of their groups', async () => {
    serveAccount({
      own: [roleAssignment(VIEWER, repositoryHref(1))],
      groups: [{ id: 3, rows: [roleAssignment(OWNER, repositoryHref(2))] }],
    });

    renderWithProviders(<Probe />, { signedIn: true });
    await state('ready');

    expect(latest.can(repositoryHref(1), VIEW)).toBe(true);
    expect(latest.can(repositoryHref(1), SYNC)).toBe(false);
    expect(latest.can(repositoryHref(2), SYNC)).toBe(true);
    expect(latest.can(repositoryHref(9), VIEW)).toBe(false);
  });

  it('asks only for the role and the object of each assignment and takes the permissions from one read of the roles', async () => {
    serveAccount({
      own: [roleAssignment(VIEWER, repositoryHref(1))],
      groups: [{ id: 3, rows: [roleAssignment(OWNER, repositoryHref(2))] }],
    });

    renderWithProviders(<Probe />, { signedIn: true });
    await state('ready');

    const user = recorder.reads.filter((read) =>
      read.startsWith(`${API}/users/7/roles/`),
    );
    const group = recorder.reads.filter((read) =>
      read.startsWith(`${API}/groups/3/roles/`),
    );
    const catalogue = recorder.reads.filter((read) =>
      read.startsWith(`${API}/roles/`),
    );
    expect(user).toHaveLength(1);
    expect(group).toHaveLength(1);
    expect(catalogue).toHaveLength(1);
    for (const read of [...user, ...group]) {
      const query = new URL(read, 'https://pulp.example').searchParams;
      expect(query.getAll('fields').sort()).toEqual(['content_object', 'role']);
      expect(query.get('limit')).toBe('1000');
      expect(query.has('content_object')).toBe(false);
    }
    const roles = new URL(catalogue[0], 'https://pulp.example').searchParams;
    expect(roles.getAll('fields').sort()).toEqual(['name', 'permissions']);
  });

  it('answers a page of 500 rows without a request beyond the index reads', async () => {
    const objects = Array.from({ length: 500 }, (_, id) => repositoryHref(id));
    serveAccount({
      own: objects
        .filter((_, id) => id % 2 === 0)
        .map((href) => roleAssignment(OWNER, href)),
    });

    renderWithProviders(<Probe objects={objects} />, { signedIn: true });
    await state('ready');
    const afterIndex = recorder.reads.length;
    expect(afterIndex).toBe(2);

    await waitFor(() => expect(screen.getByText('allowed: 250')).toBeTruthy());
    expect(asked).toBeGreaterThanOrEqual(500);
    expect(recorder.reads).toHaveLength(afterIndex);
    expect(
      recorder.reads.filter((read) => read.includes('my_permissions')),
    ).toEqual([]);
    expect(
      recorder.reads.filter((read) => read.startsWith(REPOSITORIES)),
    ).toEqual([]);
  });

  it('reads the next pages behind the first and answers from what has arrived, hiding what it does not know yet', async () => {
    const rows = Array.from({ length: 1005 }, (_, id) =>
      roleAssignment(OWNER, repositoryHref(id)),
    );
    serveAccount({ own: rows });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*${API}/users/7/roles/`, async ({ request }) => {
        if (new URL(request.url).searchParams.get('offset') === '1000') {
          await gate;
        }
        return undefined;
      }),
    );

    renderWithProviders(<Probe />, { signedIn: true });

    await waitFor(() => expect(latest.can(repositoryHref(0), SYNC)).toBe(true));
    expect(latest.state).toBe('loading');
    expect(latest.can(repositoryHref(1004), SYNC)).toBe(false);

    release();
    await state('ready');
    expect(latest.can(repositoryHref(1004), SYNC)).toBe(true);
  });

  it('keeps at most two pages of one list in flight', async () => {
    const rows = Array.from({ length: 6500 }, (_, id) =>
      roleAssignment(OWNER, repositoryHref(id)),
    );
    serveAccount({ own: rows });
    let inFlight = 0;
    let most = 0;
    server.use(
      http.get(`*${API}/users/7/roles/`, async ({ request }) => {
        if (new URL(request.url).searchParams.has('content_object')) {
          return undefined;
        }
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight--;
        return undefined;
      }),
    );

    renderWithProviders(<Probe />, { signedIn: true });
    await state('ready');

    expect(most).toBe(2);
    expect(latest.can(repositoryHref(6499), SYNC)).toBe(true);
  });

  it('reports a failed page as an error that offers a retry, and reads again on retry', async () => {
    const rows = Array.from({ length: 1005 }, (_, id) =>
      roleAssignment(OWNER, repositoryHref(id)),
    );
    serveAccount({ own: rows });
    let failing = true;
    server.use(
      http.get(`*${API}/users/7/roles/`, ({ request }) =>
        failing && new URL(request.url).searchParams.get('offset') === '1000'
          ? HttpResponse.json({ detail: 'boom' }, { status: 500 })
          : undefined,
      ),
    );

    renderWithProviders(<Probe />, { signedIn: true });
    await state('error');
    expect(latest.can(repositoryHref(1004), SYNC)).toBe(false);

    failing = false;
    act(() => latest.retry());

    await state('ready');
    expect(latest.can(repositoryHref(1004), SYNC)).toBe(true);
  });

  it('is an error, never a refusal, when the roles catalogue cannot be read', async () => {
    serveAccount({ own: [roleAssignment(OWNER, repositoryHref(1))] });
    server.use(
      http.get(`*${API}/roles/`, () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    );

    renderWithProviders(<Probe />, { signedIn: true });

    await state('error');
    expect(latest.can(repositoryHref(1), SYNC)).toBe(false);
  });

  it('takes the permissions of each role from the assignments when the account may not read the roles', async () => {
    serveAccount({
      own: [
        roleAssignment(VIEWER, repositoryHref(1), { permissions: [VIEW] }),
      ],
      groups: [
        {
          id: 3,
          rows: [
            roleAssignment(OWNER, repositoryHref(2), {
              permissions: [VIEW, SYNC, DELETE],
            }),
          ],
        },
      ],
    });
    server.use(
      http.get(`*${API}/roles/`, () =>
        HttpResponse.json(
          { detail: 'You do not have permission to perform this action.' },
          { status: 403 },
        ),
      ),
    );

    renderWithProviders(<Probe />, { signedIn: true });
    await state('ready');

    expect(latest.can(repositoryHref(1), VIEW)).toBe(true);
    expect(latest.can(repositoryHref(1), SYNC)).toBe(false);
    expect(latest.can(repositoryHref(2), SYNC)).toBe(true);
    expect(latest.can(repositoryHref(9), VIEW)).toBe(false);

    // the roles were asked for once and not again, and the assignments were
    // asked for their permissions in place of the roles
    const roles = recorder.reads.filter((read) =>
      read.startsWith(`${API}/roles/`),
    );
    expect(roles).toHaveLength(1);
    const assignments = recorder.reads.filter((read) =>
      /\/(users|groups)\/\d+\/roles\//.test(read),
    );
    expect(assignments).toHaveLength(2);
    for (const read of assignments) {
      const query = new URL(read, 'https://pulp.example').searchParams;
      expect(query.getAll('fields').sort()).toEqual([
        'content_object',
        'permissions',
        'role',
      ]);
    }
  });

  it('does not take a refused roles read for a failed one, and still fails when an assignment page fails', async () => {
    serveAccount({ own: [roleAssignment(OWNER, repositoryHref(1))] });
    server.use(
      http.get(`*${API}/roles/`, () =>
        HttpResponse.json({ detail: 'no' }, { status: 403 }),
      ),
      http.get(`*${API}/users/7/roles/`, () =>
        HttpResponse.json({ detail: 'boom' }, { status: 500 }),
      ),
    );

    renderWithProviders(<Probe />, { signedIn: true });

    await state('error');
    expect(latest.can(repositoryHref(1), SYNC)).toBe(false);
  });

  it('reads nothing while the screen has not asked for it', async () => {
    serveAccount({ own: [roleAssignment(OWNER, repositoryHref(1))] });

    renderWithProviders(<Probe enabled={false} />, { signedIn: true });
    await state('loading');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(recorder.reads).toEqual([]);
  });

  it('reads once per session: a second screen and a remount ask nothing more', async () => {
    serveAccount({ own: [roleAssignment(OWNER, repositoryHref(1))] });
    const queryClient = createTestQueryClient();

    const first = renderWithProviders(<Probe />, {
      signedIn: true,
      queryClient,
    });
    await state('ready');
    const afterFirst = recorder.reads.length;
    first.unmount();

    renderWithProviders(
      <>
        <Probe />
        <Probe />
      </>,
      { signedIn: true, queryClient },
    );
    await waitFor(() =>
      expect(screen.getAllByText('state: ready')).toHaveLength(2),
    );

    expect(recorder.reads).toHaveLength(afterFirst);
  });

  it('reads no roles for a staff account, which the permission provider treats as holding everything', async () => {
    serveAccount({
      isStaff: true,
      own: [roleAssignment(VIEWER, repositoryHref(1))],
    });

    renderWithProviders(<Probe />, { signedIn: true });
    await state('ready');

    expect(latest.can(repositoryHref(5), DELETE)).toBe(true);
    expect(recorder.reads).toEqual([]);
  });

  it('reads no roles and is an error when the own record cannot be read', async () => {
    serveAccount({ recordStatus: 500 });

    renderWithProviders(<Probe />, { signedIn: true });

    await state('error');
    expect(latest.can(repositoryHref(1), VIEW)).toBe(false);
    expect(recorder.reads).toEqual([]);
  });

  it('does not count a role held on every object as a role on a given object', async () => {
    serveAccount({ own: [roleAssignment(OWNER, null)] });

    renderWithProviders(<Probe />, { signedIn: true });
    await state('ready');

    expect(latest.can(repositoryHref(1), SYNC)).toBe(false);
  });
});
