import { HttpResponse, http } from 'msw';
import { type ReactNode, useState } from 'react';
import { usePermissions } from '../permissions';
import { listOf } from './pulp';
import { server } from './server';

// Serves what the permission provider reads for one signed-in user: the
// session check, the user's own record, their own global roles and the global
// roles of each group of the record. Every request path is recorded, so a test
// can say what was and was not asked.

const API = '/pulp/api/v3';

export interface IPermissionSetup {
  id?: number;
  username?: string;
  isStaff?: boolean;
  // permissions of the roles the user holds themselves
  own?: string[][];
  // one entry per group: the permissions of each role the group holds
  groups?: { id: number; roles: string[][] }[];
}

const entries = (roles: string[][]) =>
  roles.map((permissions, i) => ({
    pulp_href: `${API}/roles/entry-${i}/`,
    role: `role-${i}`,
    content_object: null,
    permissions,
  }));

export function servePermissions({
  id = 7,
  username = 'zoe',
  isStaff = false,
  own = [],
  groups = [],
}: IPermissionSetup = {}) {
  const requests: string[] = [];
  const session = { username, pulp_href: `${API}/users/${id}/` };

  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith(`${API}/users/`)) {
      requests.push(`${url.pathname}${url.search}`);
    }
    if (url.pathname.startsWith(`${API}/groups/`)) {
      requests.push(`${url.pathname}${url.search}`);
    }
  });

  server.use(
    http.get(`*${API}/login/`, () => HttpResponse.json(session)),
    http.post(`*${API}/login/`, () =>
      HttpResponse.json(session, { status: 201 }),
    ),
    http.get(`*${API}/users/${id}/`, () =>
      HttpResponse.json({
        ...session,
        id,
        is_staff: isStaff,
        groups: groups.map((group) => ({
          id: group.id,
          name: `group-${group.id}`,
          pulp_href: `${API}/groups/${group.id}/`,
        })),
      }),
    ),
    listOf(`${API}/users/${id}/roles/`, entries(own), { pageSize: 500 })
      .handler,
    ...groups.map(
      (group) =>
        listOf(`${API}/groups/${group.id}/roles/`, entries(group.roles), {
          pageSize: 500,
        }).handler,
    ),
  );

  return { requests, stop: () => server.events.removeAllListeners() };
}

// Renders its children once the permission read has answered for the first
// time and keeps them after that, so a screen that decides at mount what it
// may show sees the answer, as it does in the application once a session is
// known. A later reset of the permissions does not unmount the screen.
export function PermissionsKnown({ children }: { children: ReactNode }) {
  const { state } = usePermissions();
  const [known, setKnown] = useState(false);

  if (state === 'ready' && !known) {
    setKnown(true);
  }

  return known || state === 'ready' ? <>{children}</> : null;
}
