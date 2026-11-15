import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { group, listOf, page, user } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import GroupDetail from './group-management/group-detail';
import GroupList from './group-management/group-list';
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

const refused = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
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
        <SignInAgain />
        <GroupList />
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
        <SignInAgain />
        <Routes>
          <Route path='/groups/detail/:group' element={<GroupDetail />} />
        </Routes>
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
        <SignInAgain />
        <UserList />
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
        <SignInAgain />
        <Routes>
          <Route path='/users/detail/:user_id' element={<UserDetail />} />
          <Route path='/users/edit/:user_id' element={<UserEdit />} />
        </Routes>
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
