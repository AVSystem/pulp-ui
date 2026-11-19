import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useNavigate } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { groupPage, groupRow, listOf, page } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import GroupList from './group-list';

const GROUPS = '/pulp/api/v3/groups/';
const FAILED = 'Groups list could not be displayed.';

function renderGroups(route = '/groups') {
  servePermissions({ isStaff: true });
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <GroupList />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type='button' onClick={() => navigate(to)}>
      {`go ${to}`}
    </button>
  );
}

afterEach(() => {
  resetSessionEvents();
});

describe('the group list', () => {
  it('shows the rows with links to the group', async () => {
    const row = groupRow({
      id: 31,
      pulp_href: '/pulp/api/v3/groups/31/',
      name: 'zz-ops',
    });
    server.use(listOf(GROUPS, [row]).handler);
    renderGroups();

    const link = await screen.findByRole('link', { name: 'zz-ops' });

    expect(link.getAttribute('href')).toMatch(/^\/groups\/detail\/31\/?$/);
    expect(screen.getByLabelText('Group list')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: /Group name/ }),
    ).toBeInTheDocument();
  });

  it('lists ten rows by name when the address names nothing', async () => {
    const list = listOf(GROUPS, [groupRow({ name: 'zz-ops' })]);
    server.use(list.handler);
    renderGroups();

    await screen.findByText('zz-ops');

    expect(list.queries).toHaveLength(1);
    expect(Object.fromEntries(list.queries[0])).toEqual({
      offset: '0',
      limit: '10',
      ordering: 'name',
    });
  });

  it('asks for the page, order and filter of the address', async () => {
    const list = listOf(GROUPS, [
      ...Array.from({ length: 5 }, (_, n) =>
        groupRow({ name: `zz-first-${n}` }),
      ),
      groupRow({ name: 'zz-alpha' }),
    ]);
    server.use(list.handler);
    renderGroups('/groups?name__icontains=al&page=2&page_size=5&sort=-name');

    await screen.findByText('zz-alpha');

    expect(list.queries).toHaveLength(1);
    expect(Object.fromEntries(list.queries[0])).toEqual({
      offset: '5',
      limit: '5',
      ordering: '-name',
      name__icontains: 'al',
    });
  });

  it('reads the list in the other order when the name header is pressed', async () => {
    const list = listOf(GROUPS, [groupRow({ name: 'zz-ops' })]);
    server.use(list.handler);
    const { user, container } = renderGroups();
    await screen.findByText('zz-ops');

    await user.click(
      container.querySelector('[data-cy="sort_name"]') as Element,
    );

    await screen.findByText('zz-ops');
    const orders = list.queries.map((query) => query.get('ordering'));
    expect(orders[0]).toBe('name');
    expect(orders[orders.length - 1]).toBe('-name');
  });

  it('shows only the rows of the newest filter when an older answer arrives last', async () => {
    let releaseOlder: () => void = () => undefined;
    const older = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    server.use(
      http.get(`*${GROUPS}`, async ({ request }) => {
        const filter = new URL(request.url).searchParams.get('name__icontains');
        if (filter === null) {
          await older;
          return HttpResponse.json(groupPage([groupRow({ name: 'zz-old' })]));
        }
        return HttpResponse.json(groupPage([groupRow({ name: 'zz-new' })]));
      }),
    );
    servePermissions({ isStaff: true });
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Go to='/groups?name__icontains=new' />
        <GroupList />
      </AppContextProvider>,
      { route: '/groups' },
    );

    await user.click(
      screen.getByRole('button', { name: 'go /groups?name__icontains=new' }),
    );
    expect(await screen.findByText('zz-new')).toBeInTheDocument();
    releaseOlder();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(screen.getByText('zz-new')).toBeInTheDocument();
    expect(screen.queryByText('zz-old')).toBeNull();
  });

  it('says there are no groups only for a successful empty answer', async () => {
    server.use(listOf(GROUPS, []).handler);
    renderGroups();

    expect(await screen.findByText('No groups yet')).toBeInTheDocument();
  });

  it('shows the filter empty state when a filter matches nothing', async () => {
    server.use(listOf(GROUPS, []).handler);
    renderGroups('/groups?name__icontains=nobody');

    expect(await screen.findByText(/No results found/i)).toBeInTheDocument();
    expect(screen.queryByText('No groups yet')).toBeNull();
  });

  it('shows the insufficient permissions page, with the server reason and no alert, when the read is refused', async () => {
    server.use(
      http.get(`*${GROUPS}`, () =>
        HttpResponse.json({ detail: 'Not allowed.' }, { status: 403 }),
      ),
    );
    renderGroups();

    expect(
      await screen.findByText('Insufficient permissions'),
    ).toBeInTheDocument();
    expect(screen.getByText('Not allowed.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Groups' })).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('a group list read that fails', () => {
  const broken = () =>
    http.get(`*${GROUPS}`, () =>
      HttpResponse.json({ detail: 'broken' }, { status: 500 }),
    );

  it('offers Retry instead of saying there are no groups, and lists after a fixed read', async () => {
    server.use(broken());
    const { user } = renderGroups();

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText('No groups yet')).toBeNull();
    expect(screen.queryByText('Groups will appear once created')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();

    server.use(listOf(GROUPS, [groupRow({ name: 'zz-ops' })]).handler);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('zz-ops')).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('shows an answer in the wrong shape as a failed read', async () => {
    server.use(
      http.get(`*${GROUPS}`, () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [{ name: 'zz-nameless-address' }],
        }),
      ),
    );
    renderGroups();

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No groups yet')).toBeNull();
  });

  it('keeps the rows and adds one alert, no empty state, when a read of the same list fails', async () => {
    serveSignIn();
    server.use(listOf(GROUPS, [groupRow({ name: 'zz-ops' })]).handler);
    const { user } = renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <GroupList />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/groups' },
    );
    await screen.findByText('zz-ops');
    await signedIn();
    server.use(broken());

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.getByText('zz-ops')).toBeInTheDocument();
    expect(screen.getAllByText(FAILED)).toHaveLength(1);
    expect(screen.queryByText('No groups yet')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows no rows of another filter when the read for the new filter fails', async () => {
    server.use(
      http.get(`*${GROUPS}`, ({ request }) =>
        new URL(request.url).searchParams.has('name__icontains')
          ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
          : HttpResponse.json(groupPage([groupRow({ name: 'zz-all' })])),
      ),
    );
    servePermissions({ isStaff: true });
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Go to='/groups?name__icontains=beta' />
        <GroupList />
      </AppContextProvider>,
      { route: '/groups' },
    );
    await screen.findByText('zz-all');

    await user.click(
      screen.getByRole('button', { name: 'go /groups?name__icontains=beta' }),
    );

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText('zz-all')).toBeNull();
    expect(screen.queryByText('No groups yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

const HINT = 'Contact your organization administrator for more information.';
const ops = groupRow({
  id: 31,
  pulp_href: '/pulp/api/v3/groups/31/',
  name: 'zz-ops',
});
const dev = groupRow({
  id: 32,
  pulp_href: '/pulp/api/v3/groups/32/',
  name: 'zz-dev',
});

const nameField = async () =>
  within(await screen.findByRole('dialog')).getByRole('textbox');

describe('creating a group', () => {
  function renderCreate(permissions = { isStaff: true }) {
    servePermissions(permissions);
    return renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <Routes>
            <Route path='/groups' element={<GroupList />} />
            <Route
              path='/groups/detail/:group'
              element={<p>the detail screen</p>}
            />
          </Routes>
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/groups' },
    );
  }

  async function submit(user: ReturnType<typeof renderCreate>['user']) {
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await user.type(await nameField(), 'zz-new');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Create',
      }),
    );
  }

  it('sends one POST with the name, reads the list again and opens the new group', async () => {
    const posts: unknown[] = [];
    const list = listOf(GROUPS, [ops]);
    server.use(
      list.handler,
      http.post(`*${GROUPS}`, async ({ request }) => {
        posts.push(await request.json());
        return HttpResponse.json(
          groupRow({
            id: 33,
            pulp_href: '/pulp/api/v3/groups/33/',
            name: 'zz-new',
          }),
          { status: 201 },
        );
      }),
    );
    const { user } = renderCreate();
    await screen.findByText('zz-ops');

    await submit(user);

    expect(await screen.findByText('the detail screen')).toBeInTheDocument();
    expect(posts).toEqual([{ name: 'zz-new' }]);
    await waitFor(() => expect(list.queries).toHaveLength(2));
  });

  it('shows the message of the server under the name field and sends nothing more', async () => {
    let posts = 0;
    server.use(
      listOf(GROUPS, [ops]).handler,
      http.post(`*${GROUPS}`, () => {
        posts += 1;
        return HttpResponse.json(
          { name: ['A group with this name already exists.'] },
          { status: 400 },
        );
      }),
    );
    const { user } = renderCreate();
    await screen.findByText('zz-ops');

    await submit(user);

    expect(
      await screen.findByText('A group with this name already exists.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(posts).toBe(1);
  });

  it('says what was refused, why and whom to ask, and keeps the dialog', async () => {
    server.use(
      listOf(GROUPS, [ops]).handler,
      http.post(`*${GROUPS}`, () =>
        HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
      ),
    );
    const { user } = renderCreate();
    await screen.findByText('zz-ops');

    await submit(user);

    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(
        /You do not have permission to do this\. Not for you\./,
      ),
    ).toHaveTextContent(HINT);
    expect(await nameField()).toHaveValue('zz-new');
  });

  it('keeps the dialog and its name, with no message, when the session ends', async () => {
    serveSignIn();
    let posts = 0;
    server.use(listOf(GROUPS, [ops]).handler);
    const { user } = renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <GroupList />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/groups' },
    );
    await screen.findByText('zz-ops');
    await signedIn();
    server.use(
      http.post(`*${GROUPS}`, () => {
        posts += 1;
        return HttpResponse.json({ detail: 'no' }, { status: 401 });
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await user.type(await nameField(), 'zz-new');
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Create',
      }),
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(posts).toBe(1);
    expect(await nameField()).toHaveValue('zz-new');
    expect(screen.queryByText(/You do not have permission/)).toBeNull();
  });
});

describe('deleting a group from the list', () => {
  const MEMBERS = `*${GROUPS}:id/users/`;

  // Serves the list (without ops once it is gone), the removal and counts the
  // requests.
  function serveRemoval({ slow = false }: { slow?: boolean } = {}) {
    const calls = { lists: 0, deletes: [] as string[] };
    let gone = false;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*${GROUPS}`, () => {
        calls.lists += 1;
        return HttpResponse.json(groupPage(gone ? [dev] : [ops, dev]));
      }),
      http.get(MEMBERS, () => HttpResponse.json(page([]))),
      http.delete(`*${GROUPS}31/`, async ({ request }) => {
        calls.deletes.push(new URL(request.url).pathname);
        if (slow) {
          await held;
        }
        gone = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return { calls, release: () => release() };
  }

  async function openDeleteDialog(
    user: ReturnType<typeof renderGroups>['user'],
  ) {
    const row = (await screen.findByText('zz-ops')).closest('tr');
    await user.click(
      within(row as HTMLElement).getByRole('button', {
        name: /actions|kebab/i,
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    return screen.getByRole('dialog');
  }

  it('sends one DELETE to the address of the group, reads the list again and reports the success', async () => {
    const { calls } = serveRemoval();
    const { user } = renderGroups();
    const dialog = await openDeleteDialog(user);
    await within(dialog).findByText(/No users will be affected/);
    expect(calls.lists).toBe(1);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Group "zz-ops" has been successfully deleted.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('zz-ops')).toBeNull());
    expect(screen.getByText('zz-dev')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.deletes).toEqual(['/pulp/api/v3/groups/31/']);
    expect(calls.lists).toBe(2);
  });

  it('does not read the members of the deleted group again, so no failed read is reported next to the success', async () => {
    let gone = false;
    const memberReads: number[] = [];
    server.use(
      http.get(`*${GROUPS}`, () =>
        HttpResponse.json(groupPage(gone ? [dev] : [ops, dev])),
      ),
      http.get(MEMBERS, () => {
        memberReads.push(1);
        return gone
          ? HttpResponse.json({ detail: 'Not found.' }, { status: 404 })
          : HttpResponse.json(page([]));
      }),
      http.delete(`*${GROUPS}31/`, () => {
        gone = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderGroups();
    const dialog = await openDeleteDialog(user);
    await within(dialog).findByText(/No users will be affected/);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Group "zz-ops" has been successfully deleted.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Users list could not be displayed.')).toBeNull();
    expect(memberReads).toHaveLength(1);
  });

  it('sends one DELETE for two presses of Delete while the first is under way', async () => {
    const { calls, release } = serveRemoval({ slow: true });
    const { user } = renderGroups();
    const dialog = await openDeleteDialog(user);
    await within(dialog).findByText(/No users will be affected/);
    const button = within(dialog).getByRole('button', { name: 'Delete' });

    await user.click(button);
    await user.click(button);
    release();

    expect(
      await screen.findByText('Group "zz-ops" has been successfully deleted.'),
    ).toBeInTheDocument();
    expect(calls.deletes).toHaveLength(1);
  });

  it('says what was refused, why and whom to ask, keeps the rows and the dialog', async () => {
    const deletes: string[] = [];
    server.use(
      listOf(GROUPS, [ops, dev]).handler,
      http.get(MEMBERS, () => HttpResponse.json(page([]))),
      http.delete(`*${GROUPS}31/`, ({ request }) => {
        deletes.push(request.url);
        return HttpResponse.json({ detail: 'Not for you.' }, { status: 403 });
      }),
    );
    const { user } = renderGroups();
    const dialog = await openDeleteDialog(user);
    await within(dialog).findByText(/No users will be affected/);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Error deleting group.', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(screen.getByText('zz-ops', { selector: 'a' })).toBeInTheDocument();
    expect(deletes).toHaveLength(1);
  });

  it('lists the members of the group, read from the group, up to ten', async () => {
    const asked: { path: string; limit: string | null }[] = [];
    server.use(
      listOf(GROUPS, [ops, dev]).handler,
      http.get(MEMBERS, ({ request }) => {
        const url = new URL(request.url);
        asked.push({
          path: url.pathname,
          limit: url.searchParams.get('limit'),
        });
        return HttpResponse.json(
          page([{ username: 'zz-ann' }, { username: 'zz-bob' }]),
        );
      }),
    );
    const { user } = renderGroups();

    const dialog = await openDeleteDialog(user);

    expect(await within(dialog).findByText('zz-ann')).toBeInTheDocument();
    expect(within(dialog).getByText('zz-bob')).toBeInTheDocument();
    expect(asked).toEqual([
      { path: '/pulp/api/v3/groups/31/users/', limit: '10' },
    ]);
  });

  it('says how many users are affected when there are more than ten', async () => {
    server.use(
      listOf(GROUPS, [ops, dev]).handler,
      http.get(MEMBERS, () =>
        HttpResponse.json(
          page(
            Array.from({ length: 10 }, (_, n) => ({ username: `zz-${n}` })),
            { count: 12 },
          ),
        ),
      ),
    );
    const { user } = renderGroups();

    const dialog = await openDeleteDialog(user);

    expect(
      await within(dialog).findByText(
        'Deleting this group will affect 12 users.',
      ),
    ).toBeInTheDocument();
  });

  it('reads no members and says so when the user may not see users', async () => {
    const asked: string[] = [];
    server.use(
      listOf(GROUPS, [ops, dev]).handler,
      http.get(MEMBERS, ({ request }) => {
        asked.push(request.url);
        return HttpResponse.json(page([]));
      }),
    );
    servePermissions({ own: [['core.view_group', 'core.delete_group']] });
    const { user } = renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <GroupList />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/groups' },
    );

    const dialog = await openDeleteDialog(user);

    expect(
      within(dialog).getByText("You don't have permission to display users."),
    ).toBeInTheDocument();
    expect(asked).toEqual([]);
  });

  it('closes the dialog and says so once when the members cannot be read', async () => {
    server.use(
      listOf(GROUPS, [ops, dev]).handler,
      http.get(MEMBERS, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    const { user } = renderGroups();
    const row = (await screen.findByText('zz-ops')).closest('tr');

    await user.click(
      within(row as HTMLElement).getByRole('button', {
        name: /actions|kebab/i,
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    expect(
      await screen.findByText('Users list could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getAllByText('Users list could not be displayed.'),
    ).toHaveLength(1);
  });
});
