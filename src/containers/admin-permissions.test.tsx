import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode } from 'react';
import { Route, Routes, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { dataRoutes } from 'src/app-routes';
import {
  type IPermissionSetup,
  PermissionsKnown,
  servePermissions,
} from 'src/test-utils/permissions';
import { group, listOf, role, user } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import GroupDetail from './group-management/group-detail';
import GroupList from './group-management/group-list';
import RoleList from './role-management/role-list';
import UserDetail from './user-management/user-detail';
import UserList from './user-management/user-list';

// The administration screens decide what to offer from the permissions Pulp
// defines: the checks use those names, never a name Pulp does not know. This
// is presentation only; Pulp decides every request.

const API = '/pulp/api/v3';

// The user screens read the groups for their name filter.
beforeEach(() => {
  server.use(listOf(`${API}/groups/`, []).handler);
});

afterEach(() => {
  server.events.removeAllListeners();
});

// Signs in a user holding the given permissions through one role and renders
// the element once the permissions are known, as the route guard does.
function renderAs(
  permissions: string[],
  element: ReactNode,
  route: string,
  setup: IPermissionSetup = {},
) {
  servePermissions({ id: 1, own: [permissions], ...setup });
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>{element}</PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const button = (name: string) => screen.queryByRole('button', { name });
const rowActions = (text: string) =>
  within(screen.getByText(text).closest('tr') as HTMLElement).queryByRole(
    'button',
    { name: /actions|kebab/i },
  );

describe('the group list', () => {
  const serve = (...names: string[]) =>
    server.use(
      listOf(
        `${API}/groups/`,
        names.map((name) => group({ name })),
      ).handler,
    );

  it('shows Create only to a holder of core.add_group', async () => {
    serve('zz-alpha');
    renderAs(['core.view_group'], <GroupList />, '/groups');
    await screen.findByText('zz-alpha');
    expect(button('Create')).toBeNull();
  });

  it('shows Create to a holder of core.add_group', async () => {
    serve('zz-alpha');
    renderAs(['core.view_group', 'core.add_group'], <GroupList />, '/groups');
    await screen.findByText('zz-alpha');
    expect(button('Create')).not.toBeNull();
  });

  it('shows the empty state button only to a holder of core.add_group', async () => {
    serve();
    renderAs(['core.add_group'], <GroupList />, '/groups');
    await screen.findByText('No groups yet');
    expect(button('Create')).not.toBeNull();
  });

  it('shows no empty state button without core.add_group', async () => {
    serve();
    renderAs(['core.view_group'], <GroupList />, '/groups');
    await screen.findByText('No groups yet');
    expect(button('Create')).toBeNull();
  });

  it('offers Delete in a row only to a holder of core.delete_group', async () => {
    serve('zz-alpha');
    const { user: u } = renderAs(
      ['core.view_group', 'core.delete_group'],
      <GroupList />,
      '/groups',
    );
    await screen.findByText('zz-alpha');

    await u.click(rowActions('zz-alpha') as HTMLElement);
    expect(
      await screen.findByRole('menuitem', { name: 'Delete' }),
    ).toBeVisible();
  });

  it('draws no row actions for a viewer', async () => {
    serve('zz-alpha');
    renderAs(['core.view_group'], <GroupList />, '/groups');
    await screen.findByText('zz-alpha');
    expect(rowActions('zz-alpha')).toBeNull();
  });

  it('ignores the permission names Pulp does not know', async () => {
    serve('zz-alpha');
    renderAs(['auth.add_group', 'auth.delete_group'], <GroupList />, '/groups');
    await screen.findByText('zz-alpha');
    expect(button('Create')).toBeNull();
    expect(rowActions('zz-alpha')).toBeNull();
  });

  it('shows the list to a staff account that holds no role, whatever the page checks', async () => {
    serve('zz-alpha');
    renderAs([], <GroupList />, '/groups', { isStaff: true });
    expect(await screen.findByText('zz-alpha')).toBeVisible();
  });
});

describe('the group detail', () => {
  const GROUP = group({ id: 7, name: 'zz-ops' });
  const GROUP_PATH = `${API}/groups/7/`;

  function serveGroup() {
    server.use(
      http.get(`*${GROUP_PATH}`, () => HttpResponse.json(GROUP)),
      listOf(`${GROUP_PATH}roles/`, [
        {
          pulp_href: `${GROUP_PATH}roles/r1/`,
          pulp_created: '2000-01-01T00:00:00Z',
          role: 'zz-role',
          description: 'a role',
          permissions: [],
          content_object: null,
        },
      ]).handler,
      listOf(`${GROUP_PATH}users/`, [user({ username: 'zz-member' })]).handler,
    );
  }

  function renderDetail(permissions: string[], tab = 'access') {
    serveGroup();
    return renderAs(
      permissions,
      <Routes>
        <Route path='/groups/detail/:group' element={<GroupDetail />} />
      </Routes>,
      `/groups/detail/7?tab=${tab}`,
    );
  }

  it('offers role assignment only to a holder of core.manage_roles_group', async () => {
    renderDetail(['core.view_group', 'core.change_group']);
    await screen.findByText('zz-role');
    expect(button('Add roles')).toBeNull();
  });

  it('offers role assignment and removal to a holder of core.manage_roles_group', async () => {
    const { user: u } = renderDetail([
      'core.view_group',
      'core.manage_roles_group',
    ]);
    await screen.findByText('zz-role');

    expect(button('Add roles')).not.toBeNull();
    await u.click(rowActions('zz-role') as HTMLElement);
    expect(
      await screen.findByRole('menuitem', { name: 'Remove role' }),
    ).toBeVisible();
  });

  it('offers neither to a viewer', async () => {
    renderDetail(['core.view_group']);
    await screen.findByText('zz-role');
    expect(button('Add roles')).toBeNull();
    expect(rowActions('zz-role')).toBeNull();
    expect(button('Delete')).toBeNull();
  });

  it('shows the Users tab only to a holder of auth.view_user', async () => {
    renderDetail(['core.view_group']);
    await screen.findByText('zz-role');
    expect(screen.queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('shows the Users tab and the member names to a holder of auth.view_user', async () => {
    renderDetail(['core.view_group', 'auth.view_user'], 'users');
    expect(await screen.findByText('zz-member')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Users' })).toBeVisible();
  });

  it('offers adding and removing members only to a holder of core.change_group', async () => {
    const viewer = renderDetail(['core.view_group', 'auth.view_user'], 'users');
    await screen.findByText('zz-member');
    expect(button('Add')).toBeNull();
    expect(rowActions('zz-member')).toBeNull();
    viewer.unmount();
    server.events.removeAllListeners();

    renderDetail(
      ['core.view_group', 'auth.view_user', 'core.change_group'],
      'users',
    );
    await screen.findByText('zz-member');
    await waitFor(() => expect(button('Add')).not.toBeNull());
    expect(rowActions('zz-member')).not.toBeNull();
  });

  it('shows Delete to a holder of core.delete_group', async () => {
    renderDetail(['core.view_group', 'core.delete_group']);
    await screen.findByText('zz-role');
    expect(button('Delete')).not.toBeNull();
  });
});

describe('the user list', () => {
  const serve = (...names: string[]) =>
    server.use(
      listOf(
        `${API}/users/`,
        names.map((username) => user({ username })),
      ).handler,
    );

  it('shows Create only to a holder of auth.add_user', async () => {
    serve('zz-ann');
    renderAs(['auth.view_user'], <UserList />, '/users');
    await screen.findByText('zz-ann');
    expect(button('Create')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create' })).toBeNull();
  });

  it('shows Create to a holder of auth.add_user', async () => {
    serve('zz-ann');
    renderAs(['auth.view_user', 'auth.add_user'], <UserList />, '/users');
    await screen.findByText('zz-ann');
    expect(button('Create')).not.toBeNull();
  });

  it('shows the empty state button only to a holder of auth.add_user', async () => {
    serve();
    renderAs(['auth.add_user'], <UserList />, '/users');
    await screen.findByText('No users yet');
    // the toolbar and the empty state each offer it
    expect(screen.getAllByRole('button', { name: 'Create' })).toHaveLength(2);
  });

  it('shows no empty state button without auth.add_user', async () => {
    serve();
    renderAs(['auth.view_user'], <UserList />, '/users');
    await screen.findByText('No users yet');
    expect(screen.getByText('Users will appear once created')).toBeVisible();
    expect(button('Create')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Create' })).toBeNull();
  });

  it('offers Edit and Delete in a row to holders of auth.change_user and auth.delete_user', async () => {
    serve('zz-ann');
    const { user: u } = renderAs(
      ['auth.view_user', 'auth.change_user', 'auth.delete_user'],
      <UserList />,
      '/users',
    );
    await screen.findByText('zz-ann');

    await u.click(rowActions('zz-ann') as HTMLElement);
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });

  it('offers only Edit to a holder of auth.change_user alone', async () => {
    serve('zz-ann');
    const { user: u } = renderAs(
      ['auth.view_user', 'auth.change_user'],
      <UserList />,
      '/users',
    );
    await screen.findByText('zz-ann');

    await u.click(rowActions('zz-ann') as HTMLElement);
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeVisible();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
  });

  it('draws no row actions for a viewer and ignores names Pulp does not know', async () => {
    serve('zz-ann');
    renderAs(
      ['auth.view_user', 'core.change_user', 'core.delete_user'],
      <UserList />,
      '/users',
    );
    await screen.findByText('zz-ann');
    expect(rowActions('zz-ann')).toBeNull();
  });
});

describe('the user detail', () => {
  const USER = user({ id: 5, username: 'zz-ann' });

  function renderUser(permissions: string[]) {
    server.use(http.get(`*${API}/users/5/`, () => HttpResponse.json(USER)));
    return renderAs(
      permissions,
      <Routes>
        <Route path='/users/detail/:user_id' element={<UserDetail />} />
      </Routes>,
      '/users/detail/5',
    );
  }

  it('shows Edit and Delete to holders of auth.change_user and auth.delete_user', async () => {
    renderUser(['auth.view_user', 'auth.change_user', 'auth.delete_user']);
    await screen.findByText('zz-ann');
    expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  it('shows neither to a viewer', async () => {
    renderUser(['auth.view_user']);
    await screen.findByText('zz-ann');
    expect(button('Edit')).toBeNull();
    expect(button('Delete')).toBeNull();
  });
});

describe('the role list', () => {
  const ROLES = `${API}/roles/`;

  it('offers Edit and Delete to staff for a role that is not built in', async () => {
    server.use(
      listOf(ROLES, [role({ name: 'zz-custom', locked: false })]).handler,
    );
    const { user: u } = renderAs([], <RoleList />, '/roles', {
      isStaff: true,
    });
    await screen.findByText('zz-custom');

    await u.click(rowActions('zz-custom') as HTMLElement);
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
  });

  it('deletes a role that is not built in once the staff user confirms', async () => {
    const custom = role({ name: 'zz-custom', locked: false });
    const roleId = custom.pulp_href.split('/').filter(Boolean).pop();
    server.use(listOf(ROLES, [custom]).handler);
    const deleted: string[] = [];
    server.use(
      http.delete(`*${API}/roles/${roleId}/`, ({ request }) => {
        deleted.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user: u } = renderAs([], <RoleList />, '/roles', {
      isStaff: true,
    });
    await screen.findByText('zz-custom');

    await u.click(rowActions('zz-custom') as HTMLElement);
    await u.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await u.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );

    await waitFor(() => expect(deleted).toEqual([`${API}/roles/${roleId}/`]));
    expect(
      await screen.findByText(
        'Role "zz-custom" has been successfully deleted.',
      ),
    ).toBeVisible();
  });

  it('offers a built-in role no enabled action', async () => {
    server.use(
      listOf(ROLES, [role({ name: 'zz-builtin', locked: true })]).handler,
    );
    const { user: u } = renderAs([], <RoleList />, '/roles', {
      isStaff: true,
    });
    await screen.findByText('zz-builtin');

    await u.click(rowActions('zz-builtin') as HTMLElement);
    expect(
      await screen.findByRole('menuitem', { name: 'Edit' }),
    ).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });

  it('offers no row action to a user who is not staff', async () => {
    server.use(
      listOf(ROLES, [role({ name: 'zz-custom', locked: false })]).handler,
    );
    renderAs(['core.view_role'], <RoleList />, '/roles');
    await screen.findByText('zz-custom');
    expect(rowActions('zz-custom')).toBeNull();
  });
});

describe('the signing services screen opened by its address', () => {
  const guardedRoutes = (dataRoutes[0]?.children?.[0]?.children ?? []).filter(
    (route) => 'path' in route,
  );

  function Routed() {
    return <AppContextProvider>{useRoutes(guardedRoutes)}</AppContextProvider>;
  }

  const refusal = () =>
    document.querySelector('[data-cy=InsufficientPermissions]');

  function recordPaths() {
    const paths: string[] = [];
    server.events.on('request:start', ({ request }) => {
      paths.push(new URL(request.url).pathname);
    });
    return paths;
  }

  it('shows the insufficient permissions page and asks for no signing services without core.view_signingservice', async () => {
    server.use(listOf(`${API}/signing-services/`, []).handler);
    servePermissions({ own: [['file.view_filerepository']] });
    const paths = recordPaths();

    renderWithProviders(<Routed />, { route: '/signature-keys' });

    await waitFor(() => expect(refusal()).not.toBeNull());
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Insufficient permissions',
      }),
    ).toBeVisible();
    expect(paths.filter((path) => path.includes('/signing-services/'))).toEqual(
      [],
    );
  });

  it.each([
    ['the users list', '/users'],
    ['a group detail', '/groups/detail/zz-group'],
    ['the roles list', '/roles'],
  ])(
    'puts a page header above the insufficient permissions page for %s',
    async (_name, route) => {
      servePermissions({ own: [['file.view_filerepository']] });

      renderWithProviders(<Routed />, { route });

      await waitFor(() => expect(refusal()).not.toBeNull());
      const header = screen.getByRole('heading', {
        level: 1,
        name: 'Insufficient permissions',
      });
      expect(header).toBeVisible();
      expect(
        screen.getAllByRole('heading', { name: 'Insufficient permissions' }),
      ).toHaveLength(1);
      // The header comes first, the page with Go back follows it.
      expect(
        header.compareDocumentPosition(refusal() as Element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Go back' })).toBeVisible();
    },
  );

  it('shows the list to a holder of core.view_signingservice', async () => {
    server.use(listOf(`${API}/signing-services/`, []).handler);
    servePermissions({ own: [['core.view_signingservice']] });

    renderWithProviders(<Routed />, { route: '/signature-keys' });

    expect(
      await screen.findByRole('heading', { name: 'Signature keys' }),
    ).toBeVisible();
    expect(refusal()).toBeNull();
  });

  it('shows the list to staff', async () => {
    server.use(listOf(`${API}/signing-services/`, []).handler);
    servePermissions({ isStaff: true });

    renderWithProviders(<Routed />, { route: '/signature-keys' });

    expect(
      await screen.findByRole('heading', { name: 'Signature keys' }),
    ).toBeVisible();
    expect(refusal()).toBeNull();
  });
});
