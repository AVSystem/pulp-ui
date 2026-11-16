import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode } from 'react';
import { Link, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown } from 'src/test-utils/permissions';
import {
  group,
  listOf,
  page,
  role,
  signingService,
  user,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { useUserContext } from 'src/user-context';
import GroupDetail from './group-management/group-detail';
import GroupList from './group-management/group-list';
import RoleCreate from './role-management/role-create';
import RoleEdit from './role-management/role-edit';
import RoleList from './role-management/role-list';
import UserProfile from './settings/user-profile';
import SignatureKeysList from './signature-keys/list';
import UserDetail from './user-management/user-detail';
import UserEdit from './user-management/user-edit';
import UserList from './user-management/user-list';

// What every administration screen must do once the session has ended: read
// again when the same user signs in again, keep what the user typed, and show
// no alert and no error state for a read or write that failed only because the
// session ended.

const API = '/pulp/api/v3';

afterEach(() => {
  resetSessionEvents();
});

const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));

// an open modal hides the rest of the page from the accessibility tree
const signInAgain = (u) =>
  u.click(screen.getByRole('button', { name: 'Sign in again', hidden: true }));

const refused = (
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
) =>
  http[method](`*${path}`, () =>
    HttpResponse.json({ detail: 'no' }, { status: 401 }),
  );

describe('the group list', () => {
  const GROUPS = `${API}/groups/`;

  const serve = (...names: string[]) =>
    server.use(
      listOf(
        GROUPS,
        names.map((name) => group({ name })),
      ).handler,
    );

  // the text box of the open create dialog
  const nameField = async () =>
    within(await screen.findByRole('dialog')).getByRole('textbox');

  const openDeleteDialog = async (u) => {
    await u.click(
      within(screen.getByText('zz-alpha').closest('tr')).getByRole('button', {
        name: /actions|kebab/i,
      }),
    );
    await u.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  };

  function renderGroups() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <GroupList />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/groups' },
    );
  }

  it('reads the groups again and shows the fresh rows', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    serve('zz-alpha', 'zz-beta');

    await signInAgain(u);

    expect(await screen.findByText('zz-beta')).toBeInTheDocument();
  });

  it('keeps the name typed in the create dialog while it reads again', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    await u.click(screen.getByRole('button', { name: 'Create' }));
    await u.type(await nameField(), 'zz-typed');
    serve('zz-alpha', 'zz-beta');

    await signInAgain(u);

    await waitFor(() =>
      expect(screen.getByText('zz-beta', { selector: 'a' })).toBeTruthy(),
    );
    expect(await nameField()).toHaveValue('zz-typed');
  });

  it('keeps its rows, with no alert, when the read is refused with 401', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    server.use(refused('get', GROUPS));

    await signInAgain(u);
    await pause();

    expect(screen.getByText('zz-alpha')).toBeInTheDocument();
    expect(
      screen.queryByText('Groups list could not be displayed.'),
    ).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the spinner, with no alert, when the first read is refused, and lists after signing in', async () => {
    server.use(refused('get', GROUPS));
    const { user: u } = renderGroups();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(
      screen.queryByText('Groups list could not be displayed.'),
    ).toBeNull();
    serve('zz-alpha');

    await signInAgain(u);

    expect(await screen.findByText('zz-alpha')).toBeInTheDocument();
  });

  it('still shows its alert when the read fails for another reason', async () => {
    server.use(
      http.get(`*${GROUPS}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderGroups();

    expect(
      await screen.findByText('Groups list could not be displayed.'),
    ).toBeInTheDocument();
  });

  it('lists the users a delete would affect from a Pulp-shaped answer', async () => {
    serve('zz-alpha');
    server.use(
      listOf(`${API}/users/`, [
        user({ username: 'zz-ann' }),
        user({ username: 'zz-bob' }),
      ]).handler,
    );
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();

    await openDeleteDialog(u);

    expect(await screen.findByText('zz-ann')).toBeInTheDocument();
    expect(screen.getByText('zz-bob')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('adds no alert when the delete dialog user read is refused with 401', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    server.use(refused('get', `${API}/users/`));

    await openDeleteDialog(u);
    await pause();

    expect(screen.queryByText('Users list could not be displayed.')).toBeNull();
    expect(screen.getByText(/Checking for affected users/)).toBeInTheDocument();
  });

  it('adds no alert when the delete is refused with 401', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    server.use(
      listOf(`${API}/users/`, []).handler,
      http.delete(`*${API}/groups/:id/`, () =>
        HttpResponse.json({ detail: 'no' }, { status: 401 }),
      ),
    );

    await openDeleteDialog(u);
    await screen.findByText(/No users will be affected/);
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
    await pause();

    expect(screen.queryByText('Error deleting group.')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'zz-alpha', hidden: true }),
    ).toBeInTheDocument();
  });

  it('still says so when the delete fails for another reason', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    server.use(
      listOf(`${API}/users/`, []).handler,
      http.delete(`*${API}/groups/:id/`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );

    await openDeleteDialog(u);
    await screen.findByText(/No users will be affected/);
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );

    expect(await screen.findByText('Error deleting group.')).toBeVisible();
  });

  it('sends no write', async () => {
    serve('zz-alpha');
    const recorded = recordWrites();
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();

    await signInAgain(u);
    await pause();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});

describe('the group detail', () => {
  const GROUP = group({ id: 7, name: 'zz-ops' });
  const GROUP_PATH = `${API}/groups/7/`;

  const groupRole = (role: string) => ({
    pulp_href: `${API}/groups/7/roles/${role}/`,
    pulp_created: '2000-01-01T00:00:00Z',
    role,
    description: `${role} description`,
    permissions: [],
    content_object: null,
  });

  const serveGroup = (name: string, ...roles: string[]) =>
    server.use(
      http.get(`*${GROUP_PATH}`, () => HttpResponse.json({ ...GROUP, name })),
      listOf(`${GROUP_PATH}roles/`, roles.map(groupRole)).handler,
    );

  const serveMembers = (...names: string[]) =>
    server.use(
      listOf(
        `${GROUP_PATH}users/`,
        names.map((username) => user({ username })),
      ).handler,
    );

  function renderDetail(tab = 'access') {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <Routes>
            <Route path='/groups/detail/:group' element={<GroupDetail />} />
          </Routes>
        </PermissionsKnown>
      </AppContextProvider>,
      { route: `/groups/detail/7?tab=${tab}` },
    );
  }

  const heading = (name: string) =>
    screen.findByRole('heading', { name, level: 1 });

  it('reads the group and its roles again and shows the fresh content', async () => {
    serveGroup('zz-ops', 'zz-role-a');
    const { user: u } = renderDetail();
    await heading('zz-ops');
    await screen.findByText('zz-role-a');
    await signedIn();
    serveGroup('zz-ops-renamed', 'zz-role-a', 'zz-role-b');

    await signInAgain(u);

    await heading('zz-ops-renamed');
    expect(await screen.findByText('zz-role-b')).toBeInTheDocument();
  });

  it('keeps its content, with no alert, when the reads are refused with 401', async () => {
    serveGroup('zz-ops', 'zz-role-a');
    const { user: u } = renderDetail();
    await heading('zz-ops');
    await screen.findByText('zz-role-a');
    await signedIn();
    server.use(
      refused('get', GROUP_PATH),
      refused('get', `${GROUP_PATH}roles/`),
    );

    await signInAgain(u);
    await pause();

    expect(screen.getByText('zz-role-a')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'zz-ops', level: 1 }),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/could not be displayed/)).toBeNull();
  });

  it('keeps the spinner, with no alert, when the first read is refused, and shows the group after signing in', async () => {
    server.use(refused('get', GROUP_PATH));
    const { user: u } = renderDetail();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText(/could not be displayed/)).toBeNull();
    expect(screen.queryByText(/not found/i)).toBeNull();
    serveGroup('zz-ops', 'zz-role-a');

    await signInAgain(u);

    await heading('zz-ops');
    expect(await screen.findByText('zz-role-a')).toBeInTheDocument();
  });

  it('keeps the role spinner, with no alert, when the roles read is refused, and lists after signing in', async () => {
    serveGroup('zz-ops');
    server.use(refused('get', `${GROUP_PATH}roles/`));
    const { user: u } = renderDetail();
    await heading('zz-ops');
    await signedIn();
    await pause();
    expect(screen.queryByText(/could not be displayed/)).toBeNull();
    serveGroup('zz-ops', 'zz-role-a');

    await signInAgain(u);

    expect(await screen.findByText('zz-role-a')).toBeInTheDocument();
  });

  it('still shows its alert when the group read fails for another reason', async () => {
    server.use(
      http.get(`*${GROUP_PATH}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderDetail();

    expect(
      await screen.findByText('Group could not be displayed.'),
    ).toBeInTheDocument();
  });

  it('reads the members again on the users tab', async () => {
    serveGroup('zz-ops');
    serveMembers('zz-ann');
    const { user: u } = renderDetail('users');
    await screen.findByText('zz-ann');
    await signedIn();
    serveMembers('zz-ann', 'zz-bob');

    await signInAgain(u);

    expect(await screen.findByText('zz-bob')).toBeInTheDocument();
    expect(screen.getByText('zz-ann')).toBeInTheDocument();
  });

  it('keeps the members, with no alert, when their read is refused with 401', async () => {
    serveGroup('zz-ops');
    serveMembers('zz-ann');
    const { user: u } = renderDetail('users');
    await screen.findByText('zz-ann');
    await signedIn();
    server.use(refused('get', `${GROUP_PATH}users/`));

    await signInAgain(u);
    await pause();

    expect(screen.getByText('zz-ann')).toBeInTheDocument();
    expect(screen.queryByText('Users list could not be displayed.')).toBeNull();
  });

  it('keeps the dialog and its selection when adding users is refused with 401, with no alert', async () => {
    serveGroup('zz-ops');
    serveMembers('zz-ann');
    server.use(
      listOf(`${API}/users/`, [
        user({ id: 1, username: 'zz-ann' }),
        user({ id: 2, username: 'zz-cat' }),
      ]).handler,
      refused('post', `${GROUP_PATH}users/`),
    );
    const { user: u } = renderDetail('users');
    await screen.findByText('zz-ann');
    await signedIn();

    await u.click(screen.getByRole('button', { name: 'Add' }));
    await u.click(
      await screen.findByRole('combobox', { name: 'Select users' }),
    );
    await u.click(await screen.findByRole('option', { name: /zz-cat/ }));
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }),
    );
    await pause();

    expect(screen.queryByText(/could not be added/)).toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByText('zz-cat'),
    ).toBeInTheDocument();
  });

  it('searches the users of the add dialog from a Pulp-shaped answer', async () => {
    serveGroup('zz-ops');
    serveMembers('zz-ann');
    server.use(
      http.get(`*${API}/users/`, ({ request }) => {
        const text = new URL(request.url).searchParams.get(
          'username__contains',
        );
        return HttpResponse.json(
          page(
            [
              user({ id: 1, username: 'zz-ann' }),
              user({ id: 2, username: 'zz-cat' }),
              user({ id: 3, username: 'zz-dan' }),
            ].filter((x) => !text || x.username.includes(text)),
          ),
        );
      }),
    );
    const { user: u } = renderDetail('users');
    await screen.findByText('zz-ann');
    await signedIn();

    await u.click(screen.getByRole('button', { name: 'Add' }));
    await u.type(
      await screen.findByRole('combobox', { name: 'Select users' }),
      'zz-d',
    );

    expect(await screen.findByRole('option', { name: /zz-dan/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /zz-cat/ })).toBeNull();
    expect(screen.queryByText('Users list could not be displayed.')).toBeNull();
  });

  it('adds no alert when removing a role is refused with 401', async () => {
    serveGroup('zz-ops', 'zz-role-a');
    server.use(refused('delete', `${GROUP_PATH}roles/:id/`));
    const { user: u } = renderDetail();
    await screen.findByText('zz-role-a');
    await signedIn();

    await u.click(
      within(screen.getByText('zz-role-a').closest('tr')).getByRole('button', {
        name: /actions|kebab/i,
      }),
    );
    await u.click(await screen.findByRole('menuitem', { name: 'Remove role' }));
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
    await pause();

    expect(screen.queryByText(/could not be deleted/)).toBeNull();
    expect(screen.getByText('zz-role-a')).toBeInTheDocument();
  });

  it('sends no write', async () => {
    serveGroup('zz-ops', 'zz-role-a');
    const recorded = recordWrites();
    const { user: u } = renderDetail();
    await screen.findByText('zz-role-a');
    await signedIn();

    await signInAgain(u);
    await pause();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});

describe('the user list', () => {
  const USERS = `${API}/users/`;
  const serve = (...names: string[]) =>
    server.use(
      listOf(
        USERS,
        names.map((username) => user({ username })),
      ).handler,
    );

  function renderUsers() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <UserList />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/users' },
    );
  }

  it('reads the users again and shows the fresh rows', async () => {
    serve('zz-ann');
    const { user: u } = renderUsers();
    await screen.findByText('zz-ann');
    await signedIn();
    serve('zz-ann', 'zz-bob');

    await signInAgain(u);

    expect(await screen.findByText('zz-bob')).toBeInTheDocument();
  });

  it('keeps its rows, with no alert, when the read is refused with 401', async () => {
    serve('zz-ann');
    const { user: u } = renderUsers();
    await screen.findByText('zz-ann');
    await signedIn();
    server.use(refused('get', USERS));

    await signInAgain(u);
    await pause();

    expect(screen.getByText('zz-ann')).toBeInTheDocument();
    expect(screen.queryByText('Users list could not be displayed.')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the spinner, with no alert, when the first read is refused, and lists after signing in', async () => {
    server.use(refused('get', USERS));
    const { user: u } = renderUsers();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText('Users list could not be displayed.')).toBeNull();
    serve('zz-ann');

    await signInAgain(u);

    expect(await screen.findByText('zz-ann')).toBeInTheDocument();
  });

  it('adds no alert when a delete is refused with 401', async () => {
    serve('zz-ann');
    const { user: u } = renderUsers();
    await screen.findByText('zz-ann');
    await signedIn();
    server.use(refused('delete', `${USERS}:id/`));

    await u.click(
      within(screen.getByText('zz-ann').closest('tr')).getByRole('button', {
        name: /actions|kebab/i,
      }),
    );
    await u.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
    await pause();

    expect(screen.queryByText(/could not be deleted/)).toBeNull();
  });

  it('closes the delete dialog without an alert when the session ends while the removal is confirmed', async () => {
    serve('zz-ann');
    const { user: u } = renderUsers();
    await screen.findByText('zz-ann');
    await signedIn();
    let reads = 0;
    server.use(
      http.delete(
        `*${USERS}:id/`,
        () => new HttpResponse(null, { status: 204 }),
      ),
      http.get(`*${USERS}:id/`, () => {
        reads += 1;
        return HttpResponse.json({ detail: 'no' }, { status: 401 });
      }),
    );

    await u.click(
      within(screen.getByText('zz-ann').closest('tr')).getByRole('button', {
        name: /actions|kebab/i,
      }),
    );
    await u.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(reads).toBe(1);
    expect(screen.queryByText(/could not be deleted/)).toBeNull();
  });

  it('sends no write', async () => {
    serve('zz-ann');
    const recorded = recordWrites();
    const { user: u } = renderUsers();
    await screen.findByText('zz-ann');
    await signedIn();

    await signInAgain(u);
    await pause();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});

describe('the user detail and the user edit page', () => {
  const USER = user({ id: 4, username: 'zz-ann', first_name: 'Ann' });
  const USER_PATH = `${API}/users/4/`;
  const serve = (firstName: string) =>
    server.use(
      http.get(`*${USER_PATH}`, () =>
        HttpResponse.json({ ...USER, first_name: firstName }),
      ),
    );

  function renderAt(route: string) {
    serveSignIn();
    server.use(listOf(`${API}/groups/`, []).handler);
    return renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <Link to='/users/edit/5'>Other user</Link>
          <Routes>
            <Route path='/users/detail/:user_id' element={<UserDetail />} />
            <Route path='/users/edit/:user_id' element={<UserEdit />} />
          </Routes>
        </PermissionsKnown>
      </AppContextProvider>,
      { route },
    );
  }

  const firstName = () => screen.findByLabelText(/First name/);

  describe('detail', () => {
    it('reads the user again and shows the fresh value', async () => {
      serve('Ann');
      const { user: u } = renderAt('/users/detail/4');
      expect(await screen.findByText('Ann')).toBeInTheDocument();
      await signedIn();
      serve('Anna');

      await signInAgain(u);

      expect(await screen.findByText('Anna')).toBeInTheDocument();
    });

    it('keeps the user, with no error page, when the read is refused with 401', async () => {
      serve('Ann');
      const { user: u } = renderAt('/users/detail/4');
      await screen.findByText('Ann');
      await signedIn();
      server.use(refused('get', USER_PATH));

      await signInAgain(u);
      await pause();

      expect(screen.getByText('Ann')).toBeInTheDocument();
      expect(screen.queryByText(/not found/i)).toBeNull();
    });

    it('keeps the spinner, with no not-found page, when the first read is refused, and shows the user after signing in', async () => {
      server.use(refused('get', USER_PATH));
      const { user: u } = renderAt('/users/detail/4');
      await signedIn();
      await pause();
      expect(screen.getByRole('progressbar')).toBeVisible();
      expect(screen.queryByText(/not found/i)).toBeNull();
      serve('Ann');

      await signInAgain(u);

      expect(await screen.findByText('Ann')).toBeInTheDocument();
    });

    it('still shows the not-found page when the read fails for another reason', async () => {
      server.use(
        http.get(`*${USER_PATH}`, () =>
          HttpResponse.json({ detail: 'gone' }, { status: 404 }),
        ),
      );
      renderAt('/users/detail/4');

      expect(await screen.findByText(/not found/i)).toBeInTheDocument();
    });
  });

  describe('edit', () => {
    it('shows the fresh user after signing in again when nothing was typed', async () => {
      serve('Ann');
      const { user: u } = renderAt('/users/edit/4');
      expect(await firstName()).toHaveValue('Ann');
      await signedIn();
      serve('Anna');

      await signInAgain(u);

      await waitFor(() =>
        expect(screen.getByLabelText(/First name/)).toHaveValue('Anna'),
      );
    });

    it('keeps the typed first name when the user is read again', async () => {
      serve('Ann');
      const { user: u } = renderAt('/users/edit/4');
      const field = await firstName();
      await signedIn();
      await u.clear(field);
      await u.type(field, 'Typed');
      let reads = 0;
      server.use(
        http.get(`*${USER_PATH}`, () => {
          reads += 1;
          return HttpResponse.json({ ...USER, first_name: 'Fresh' });
        }),
      );

      await signInAgain(u);

      await waitFor(() => expect(reads).toBe(1));
      await pause();
      expect(screen.getByLabelText(/First name/)).toHaveValue('Typed');
    });

    it('keeps the form, with no unauthorized page, when the read is refused with 401', async () => {
      serve('Ann');
      const { user: u } = renderAt('/users/edit/4');
      await firstName();
      await signedIn();
      server.use(refused('get', USER_PATH));

      await signInAgain(u);
      await pause();

      expect(screen.getByLabelText(/First name/)).toHaveValue('Ann');
      expect(screen.queryByText(/permission/i)).toBeNull();
    });

    it('keeps the spinner, with no unauthorized page, when the first read is refused, and shows the form after signing in', async () => {
      server.use(refused('get', USER_PATH));
      const { user: u } = renderAt('/users/edit/4');
      await signedIn();
      await pause();
      expect(screen.getByRole('progressbar')).toBeVisible();
      expect(screen.queryByText(/permission/i)).toBeNull();
      serve('Ann');

      await signInAgain(u);

      expect(await firstName()).toHaveValue('Ann');
    });

    describe('when another user is opened', () => {
      const OTHER = user({ id: 5, username: 'zz-bea', first_name: 'Bea' });
      const OTHER_PATH = `${API}/users/5/`;
      const serveOther = () =>
        server.use(http.get(`*${OTHER_PATH}`, () => HttpResponse.json(OTHER)));

      // answers the read of user 4 only once release() is called
      function holdFirstUser() {
        let release: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        server.use(
          http.get(`*${USER_PATH}`, async () => {
            await gate;
            return HttpResponse.json(USER);
          }),
        );
        return { release: () => release() };
      }

      it('clears the form of the previous user while the new one is read', async () => {
        serve('Ann');
        const { user: u } = renderAt('/users/edit/4');
        expect(await firstName()).toHaveValue('Ann');
        let release: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        server.use(
          http.get(`*${OTHER_PATH}`, async () => {
            await gate;
            return HttpResponse.json(OTHER);
          }),
        );

        await u.click(screen.getByRole('link', { name: 'Other user' }));

        await waitFor(() =>
          expect(screen.queryByLabelText(/First name/)).toBeNull(),
        );
        expect(screen.getByRole('progressbar')).toBeVisible();
        release();
        expect(await firstName()).toHaveValue('Bea');
      });

      it('ignores the late answer for the previous user', async () => {
        const first = holdFirstUser();
        serveOther();
        const { user: u } = renderAt('/users/edit/4');

        await u.click(await screen.findByRole('link', { name: 'Other user' }));
        expect(await firstName()).toHaveValue('Bea');
        first.release();
        await pause();

        expect(screen.getByLabelText(/First name/)).toHaveValue('Bea');
      });
    });

    it('sends no write', async () => {
      serve('Ann');
      const recorded = recordWrites();
      const { user: u } = renderAt('/users/edit/4');
      await firstName();
      await signedIn();

      await signInAgain(u);
      await pause();

      expect(recorded.writes).toEqual([`POST ${API}/login/`]);
      recorded.stop();
    });
  });
});

// The profile page reads the signed-in user, so it is shown once the session
// check has answered, as the route guard of the application does.
function AfterSession({ children }: { children: ReactNode }) {
  const { status } = useUserContext();
  return status === 'authenticated' ? <>{children}</> : null;
}

describe('the profile page', () => {
  // The sign-in handlers come first so a test's own answer for the record
  // takes precedence over theirs.
  beforeEach(() => serveSignIn());

  // the signed-in user's own record, read by its address
  const USERS = `${API}/users/1/`;
  const serve = (firstName: string) =>
    server.use(
      http.get(`*${USERS}`, () =>
        HttpResponse.json({
          ...user({ id: 1, username: 'zoe', first_name: firstName }),
          // an administrator, who may change users and so is offered Edit
          is_staff: true,
        }),
      ),
      listOf(`${API}/groups/`, []).handler,
    );

  function renderProfile() {
    return renderWithProviders(
      <AppContextProvider>
        <SignInAgain />
        <AfterSession>
          <UserProfile />
        </AfterSession>
      </AppContextProvider>,
      { route: '/users/profile' },
    );
  }

  it('shows the fresh profile after signing in again when nothing was typed', async () => {
    serve('Zo');
    const { user: u } = renderProfile();
    expect(await screen.findByText('Zo')).toBeInTheDocument();
    serve('Zoe');

    await signInAgain(u);

    expect(await screen.findByText('Zoe')).toBeInTheDocument();
  });

  it('keeps the typed last name when the profile is read again', async () => {
    serve('Zo');
    const { user: u } = renderProfile();
    await screen.findByText('Zo');
    await u.click(await screen.findByRole('button', { name: 'Edit' }));
    const field = await screen.findByLabelText(/Last name/);
    await u.type(field, 'Typed');
    let reads = 0;
    server.use(
      http.get(`*${USERS}`, () => {
        reads += 1;
        return HttpResponse.json({
          ...user({ id: 1, username: 'zoe', last_name: 'Fresh' }),
          is_staff: true,
        });
      }),
    );

    await signInAgain(u);

    // the permission read and the profile read share one request for the record
    await waitFor(() => expect(reads).toBe(1));
    await pause();
    expect(screen.getByLabelText(/Last name/)).toHaveValue('Typed');
  });

  it('keeps the profile, with no error page, when the read is refused with 401', async () => {
    serve('Zo');
    const { user: u } = renderProfile();
    await screen.findByText('Zo');
    await signedIn();
    server.use(refused('get', USERS));

    await signInAgain(u);
    await pause();

    expect(screen.getByText('Zo')).toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).toBeNull();
  });

  it('keeps the spinner, with no not-found page, when the first read is refused, and shows the profile after signing in', async () => {
    server.use(refused('get', USERS), listOf(`${API}/groups/`, []).handler);
    const { user: u } = renderProfile();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText(/not found/i)).toBeNull();
    serve('Zo');

    await signInAgain(u);

    expect(await screen.findByText('Zo')).toBeInTheDocument();
  });

  it('sends no write', async () => {
    serve('Zo');
    const recorded = recordWrites();
    const { user: u } = renderProfile();
    await screen.findByText('Zo');
    await signedIn();

    await signInAgain(u);
    await pause();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});

describe('the role list', () => {
  const ROLES = `${API}/roles/`;
  const serve = (...names: string[]) =>
    server.use(
      listOf(
        ROLES,
        names.map((name) => role({ name })),
      ).handler,
    );

  function renderRoles() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <RoleList />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/roles' },
    );
  }

  it('reads the roles again and shows the fresh rows', async () => {
    serve('zz-role-a');
    const { user: u } = renderRoles();
    await screen.findByText('zz-role-a');
    await signedIn();
    serve('zz-role-a', 'zz-role-b');

    await signInAgain(u);

    expect(await screen.findByText('zz-role-b')).toBeInTheDocument();
  });

  it('keeps its rows, with no alert, when the read is refused with 401', async () => {
    serve('zz-role-a');
    const { user: u } = renderRoles();
    await screen.findByText('zz-role-a');
    await signedIn();
    server.use(refused('get', ROLES));

    await signInAgain(u);
    await pause();

    expect(screen.getByText('zz-role-a')).toBeInTheDocument();
    expect(screen.queryByText('Roles list could not be displayed.')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the spinner, with no alert, when the first read is refused, and lists after signing in', async () => {
    server.use(refused('get', ROLES));
    const { user: u } = renderRoles();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText('Roles list could not be displayed.')).toBeNull();
    serve('zz-role-a');

    await signInAgain(u);

    expect(await screen.findByText('zz-role-a')).toBeInTheDocument();
  });

  it('still shows its alert when the read fails for another reason', async () => {
    server.use(
      http.get(`*${ROLES}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderRoles();

    expect(
      await screen.findByText('Roles list could not be displayed.'),
    ).toBeInTheDocument();
  });

  it('sends no write', async () => {
    serve('zz-role-a');
    const recorded = recordWrites();
    const { user: u } = renderRoles();
    await screen.findByText('zz-role-a');
    await signedIn();

    await signInAgain(u);
    await pause();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});

describe('the role edit page', () => {
  const ROLE = role({
    pulp_href: `${API}/roles/0192e5a1-0000-7000-8000-0000000000aa/`,
    name: 'zz-role',
  });
  const ROLE_PATH = `${API}/roles/0192e5a1-0000-7000-8000-0000000000aa/`;
  const DESCRIPTION = 'Add a role description here';

  const serve = (description: string, permissions: string[] = []) =>
    server.use(
      http.get(`*${ROLE_PATH}`, () =>
        HttpResponse.json({ ...ROLE, description, permissions }),
      ),
    );

  function renderEdit() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <Routes>
            <Route path='/roles/edit/:role' element={<RoleEdit />} />
          </Routes>
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/roles/edit/0192e5a1-0000-7000-8000-0000000000aa/' },
    );
  }

  const descriptionField = () => screen.findByPlaceholderText(DESCRIPTION);

  it('shows the fresh description after signing in again when nothing was typed', async () => {
    serve('first text');
    const { user: u } = renderEdit();
    expect(await descriptionField()).toHaveValue('first text');
    await signedIn();
    serve('second text');

    await signInAgain(u);

    await waitFor(() =>
      expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveValue(
        'second text',
      ),
    );
  });

  it('keeps the typed description when the role is read again', async () => {
    serve('first text');
    const { user: u } = renderEdit();
    const field = await descriptionField();
    await signedIn();
    await u.clear(field);
    await u.type(field, 'typed text');
    let reads = 0;
    server.use(
      http.get(`*${ROLE_PATH}`, () => {
        reads += 1;
        return HttpResponse.json({ ...ROLE, description: 'fresh text' });
      }),
    );

    await signInAgain(u);

    await waitFor(() => expect(reads).toBe(1));
    await pause();
    expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveValue('typed text');
  });

  it('saves the fresh permissions of an untouched form and the typed description', async () => {
    serve('first text', ['old.permission']);
    const { user: u } = renderEdit();
    const field = await descriptionField();
    await signedIn();
    await u.clear(field);
    await u.type(field, 'typed text');
    serve('fresh text', ['new.permission']);
    await signInAgain(u);
    await pause();
    let body: unknown;
    server.use(
      http.patch(`*${ROLE_PATH}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(ROLE);
      }),
    );

    await u.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body).toEqual({
      name: 'zz-role',
      description: 'typed text',
      permissions: ['new.permission'],
    });
  });

  it('sends the save to the role address with a single trailing slash', async () => {
    serve('first text');
    const { user: u } = renderEdit();
    await descriptionField();
    await signedIn();
    let saved: string | undefined;
    server.use(
      http.patch(`*${ROLE_PATH}`, ({ request }) => {
        saved = new URL(request.url).pathname;
        return HttpResponse.json(ROLE);
      }),
    );

    await u.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toBe(ROLE_PATH);
  });

  it('keeps the form, with no alert or not-found page, when the read is refused with 401', async () => {
    serve('first text');
    const { user: u } = renderEdit();
    await descriptionField();
    await signedIn();
    server.use(refused('get', ROLE_PATH));

    await signInAgain(u);
    await pause();

    expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveValue('first text');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/not found/i)).toBeNull();
  });

  it('keeps the spinner, with no alert or not-found page, when the first read is refused, and shows the form after signing in', async () => {
    server.use(refused('get', ROLE_PATH));
    const { user: u } = renderEdit();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/not found/i)).toBeNull();
    serve('first text');

    await signInAgain(u);

    expect(await descriptionField()).toHaveValue('first text');
  });

  it('adds no alert when saving is refused with 401', async () => {
    serve('first text');
    server.use(refused('patch', ROLE_PATH));
    const { user: u } = renderEdit();
    await descriptionField();
    await signedIn();

    await u.click(screen.getByRole('button', { name: 'Save' }));
    await pause();

    expect(screen.queryByText(/could not be saved/)).toBeNull();
    expect(screen.getByPlaceholderText(DESCRIPTION)).toHaveValue('first text');
  });

  it('sends no write', async () => {
    serve('first text');
    const recorded = recordWrites();
    const { user: u } = renderEdit();
    await descriptionField();
    await signedIn();

    await signInAgain(u);
    await pause();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});

describe('the role create page', () => {
  function renderCreate() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <RoleCreate />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/roles/create' },
    );
  }

  it('shows no alert, keeps the typed form and stops saving when creating is refused with 401', async () => {
    server.use(refused('post', `${API}/roles/`));
    const { user: u } = renderCreate();
    await signedIn();
    await u.type(screen.getByPlaceholderText('Role name'), 'zz_new');
    await u.type(
      screen.getByPlaceholderText('Add a role description here'),
      'zz description',
    );

    await u.click(screen.getByRole('button', { name: 'Save' }));
    await pause();

    expect(screen.queryByText(/could not be created/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByPlaceholderText('Role name')).toHaveValue('zz_new');
    expect(
      screen.getByPlaceholderText('Add a role description here'),
    ).toHaveValue('zz description');
  });

  it('still shows its alert when creating fails for another reason', async () => {
    server.use(
      http.post(`*${API}/roles/`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    const { user: u } = renderCreate();
    await signedIn();
    await u.type(screen.getByPlaceholderText('Role name'), 'zz_new');
    await u.type(
      screen.getByPlaceholderText('Add a role description here'),
      'zz description',
    );
    await u.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Role "zz_new" could not be created.'),
    ).toBeInTheDocument();
  });
});

describe('the signing services list', () => {
  const SERVICES = `${API}/signing-services/`;
  const serve = (...names: string[]) =>
    server.use(
      listOf(
        SERVICES,
        names.map((name) => signingService({ name })),
      ).handler,
    );

  function renderServices() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <SignatureKeysList />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/signature-keys' },
    );
  }

  it('reads the services again and shows the fresh rows', async () => {
    serve('zz-signer-a');
    const { user: u } = renderServices();
    await screen.findByText('zz-signer-a');
    await signedIn();
    serve('zz-signer-a', 'zz-signer-b');

    await signInAgain(u);

    expect(await screen.findByText('zz-signer-b')).toBeInTheDocument();
  });

  it('keeps its rows, with no alert, when the read is refused with 401', async () => {
    serve('zz-signer-a');
    const { user: u } = renderServices();
    await screen.findByText('zz-signer-a');
    await signedIn();
    server.use(refused('get', SERVICES));

    await signInAgain(u);
    await pause();

    expect(screen.getByText('zz-signer-a')).toBeInTheDocument();
    expect(
      screen.queryByText('Signature keys could not be displayed.'),
    ).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the spinner, with no alert, when the first read is refused, and lists after signing in', async () => {
    server.use(refused('get', SERVICES));
    const { user: u } = renderServices();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(
      screen.queryByText('Signature keys could not be displayed.'),
    ).toBeNull();
    serve('zz-signer-a');

    await signInAgain(u);

    expect(await screen.findByText('zz-signer-a')).toBeInTheDocument();
  });

  it('still shows its alert when the read fails for another reason', async () => {
    server.use(
      http.get(`*${SERVICES}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderServices();

    expect(
      await screen.findByText('Signature keys could not be displayed.'),
    ).toBeInTheDocument();
  });

  it('sends no write', async () => {
    serve('zz-signer-a');
    const recorded = recordWrites();
    const { user: u } = renderServices();
    await screen.findByText('zz-signer-a');
    await signedIn();

    await signInAgain(u);
    await pause();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});
