import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useNavigate } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { group, listOf, userPage, userRow } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import UserList from './user-list';

const USERS = '/pulp/api/v3/users/';
const FAILED = 'Users list could not be displayed.';

function renderUsers(route = '/users') {
  servePermissions({ isStaff: true });
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <UserList />
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

const urlId = (href: string) => href.split('/').filter(Boolean).pop();

afterEach(() => {
  resetSessionEvents();
});

describe('the user list', () => {
  it('shows the rows with the names, the groups and links to the user', async () => {
    const row = userRow({
      username: 'zz-ann',
      first_name: 'Ann',
      last_name: 'Lee',
      email: 'ann@example.com',
      groups: [group({ id: 31, name: 'zz-group' })],
    });
    server.use(listOf(USERS, [row]).handler);
    renderUsers();

    const link = await screen.findByRole('link', { name: 'zz-ann' });

    expect(link).toHaveAttribute(
      'href',
      `/users/detail/${urlId(row.pulp_href)}/`,
    );
    expect(screen.getByText('Ann')).toBeInTheDocument();
    expect(screen.getByText('Lee')).toBeInTheDocument();
    expect(screen.getByText('ann@example.com')).toBeInTheDocument();
    expect(screen.getByText('zz-group')).toBeInTheDocument();
    expect(screen.getByLabelText('User list')).toBeInTheDocument();
  });

  it('lists ten rows by username when the address names nothing', async () => {
    const list = listOf(USERS, [userRow({ username: 'zz-ann' })]);
    server.use(list.handler);
    renderUsers();

    await screen.findByText('zz-ann');

    expect(list.queries).toHaveLength(1);
    expect(Object.fromEntries(list.queries[0])).toEqual({
      offset: '0',
      limit: '10',
      ordering: 'username',
    });
  });

  it('asks for the page, order and filters of the address', async () => {
    const list = listOf(USERS, [
      ...Array.from({ length: 5 }, (_, n) =>
        userRow({ username: `zz-first-${n}` }),
      ),
      userRow({ username: 'zz-alpha' }),
    ]);
    server.use(list.handler);
    renderUsers(
      '/users?username__contains=al&first_name__contains=A&last_name__contains=B&email__contains=x&page=2&page_size=5&sort=-email',
    );

    await screen.findByText('zz-alpha');

    expect(list.queries).toHaveLength(1);
    expect(Object.fromEntries(list.queries[0])).toEqual({
      offset: '5',
      limit: '5',
      ordering: '-email',
      username__contains: 'al',
      first_name__contains: 'A',
      last_name__contains: 'B',
      email__contains: 'x',
    });
  });

  it('shows only the rows of the newest filter when an older answer arrives last', async () => {
    let releaseOlder: () => void = () => undefined;
    const older = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    server.use(
      http.get(`*${USERS}`, async ({ request }) => {
        const filter = new URL(request.url).searchParams.get(
          'username__contains',
        );
        if (filter === null) {
          await older;
          return HttpResponse.json(userPage([userRow({ username: 'zz-old' })]));
        }
        return HttpResponse.json(userPage([userRow({ username: 'zz-new' })]));
      }),
    );
    servePermissions({ isStaff: true });
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Go to='/users?username__contains=new' />
        <UserList />
      </AppContextProvider>,
      { route: '/users' },
    );

    await user.click(
      screen.getByRole('button', { name: 'go /users?username__contains=new' }),
    );
    expect(await screen.findByText('zz-new')).toBeInTheDocument();
    releaseOlder();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(screen.getByText('zz-new')).toBeInTheDocument();
    expect(screen.queryByText('zz-old')).toBeNull();
  });

  it('says there are no users only for a successful empty answer', async () => {
    server.use(listOf(USERS, []).handler);
    renderUsers();

    expect(await screen.findByText('No users yet')).toBeInTheDocument();
  });

  it('shows the filter empty state when a filter matches nothing', async () => {
    server.use(listOf(USERS, []).handler);
    renderUsers('/users?username__contains=nobody');

    expect(await screen.findByText(/No results found/i)).toBeInTheDocument();
    expect(screen.queryByText('No users yet')).toBeNull();
  });

  it('shows the insufficient permissions page, with the server reason and no alert, when the read is refused', async () => {
    server.use(
      http.get(`*${USERS}`, () =>
        HttpResponse.json({ detail: 'Not allowed.' }, { status: 403 }),
      ),
    );
    renderUsers();

    expect(
      await screen.findByText('Insufficient permissions'),
    ).toBeInTheDocument();
    expect(screen.getByText('Not allowed.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('a user list read that fails', () => {
  const broken = () =>
    http.get(`*${USERS}`, () =>
      HttpResponse.json({ detail: 'broken' }, { status: 500 }),
    );

  it('offers Retry instead of saying there are no users, and lists after a fixed read', async () => {
    server.use(broken());
    const { user } = renderUsers();

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText('No users yet')).toBeNull();
    expect(screen.queryByText('Users will appear once created')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();

    server.use(listOf(USERS, [userRow({ username: 'zz-ann' })]).handler);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('zz-ann')).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('shows an answer in the wrong shape as a failed read', async () => {
    server.use(
      http.get(`*${USERS}`, () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [{ username: 'zz-nameless-address' }],
        }),
      ),
    );
    renderUsers();

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No users yet')).toBeNull();
  });

  it('keeps the rows and adds one alert, no empty state, when a read of the same list fails', async () => {
    serveSignIn();
    server.use(listOf(USERS, [userRow({ username: 'zz-ann' })]).handler);
    const { user } = renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <UserList />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/users' },
    );
    await screen.findByText('zz-ann');
    await signedIn();
    server.use(broken());

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.getByText('zz-ann')).toBeInTheDocument();
    expect(screen.getAllByText(FAILED)).toHaveLength(1);
    expect(screen.queryByText('No users yet')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows no rows of another filter when the read for the new filter fails', async () => {
    server.use(
      http.get(`*${USERS}`, ({ request }) =>
        new URL(request.url).searchParams.has('username__contains')
          ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
          : HttpResponse.json(userPage([userRow({ username: 'zz-all' })])),
      ),
    );
    servePermissions({ isStaff: true });
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Go to='/users?username__contains=beta' />
        <UserList />
      </AppContextProvider>,
      { route: '/users' },
    );
    await screen.findByText('zz-all');

    await user.click(
      screen.getByRole('button', {
        name: 'go /users?username__contains=beta',
      }),
    );

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText('zz-all')).toBeNull();
    expect(screen.queryByText('No users yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('deleting a user from the list', () => {
  const ann = userRow({
    id: 41,
    pulp_href: `${'/pulp/api/v3/users/'}41/`,
    username: 'zz-ann',
  });
  const bob = userRow({
    id: 42,
    pulp_href: `${'/pulp/api/v3/users/'}42/`,
    username: 'zz-bob',
  });

  // Serves the list (without ann once she is gone), ann's removal and
  // counts the requests. Ann is gone as soon as the delete arrives, or when the
  // test says so, to keep the confirmation waiting.
  function serveRemoval(removeOnDelete = false) {
    const calls = { lists: 0, deletes: [] as string[], reads: 0 };
    let gone = false;
    server.use(
      http.get(`*${USERS}`, () => {
        calls.lists += 1;
        return HttpResponse.json(userPage(gone ? [bob] : [ann, bob]));
      }),
      http.delete(`*${USERS}41/`, ({ request }) => {
        calls.deletes.push(new URL(request.url).pathname);
        gone = gone || removeOnDelete;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(`*${USERS}41/`, () => {
        calls.reads += 1;
        return gone
          ? HttpResponse.json({ detail: 'Not found.' }, { status: 404 })
          : HttpResponse.json(ann);
      }),
    );
    return {
      calls,
      remove: () => {
        gone = true;
      },
    };
  }

  async function openDeleteDialog(
    user: ReturnType<typeof renderUsers>['user'],
  ) {
    const row = (await screen.findByText('zz-ann')).closest('tr');
    await user.click(
      within(row as HTMLElement).getByRole('button', {
        name: /actions|kebab/i,
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    return screen.getByRole('dialog');
  }

  it('sends one DELETE to the address of the user, reads the list again and reports the success', async () => {
    const { calls } = serveRemoval(true);
    const { user } = renderUsers();
    const dialog = await openDeleteDialog(user);
    expect(calls.lists).toBe(1);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('User "zz-ann" has been successfully deleted.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('zz-ann')).toBeNull());
    expect(screen.getByText('zz-bob')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.deletes).toEqual(['/pulp/api/v3/users/41/']);
    expect(calls.lists).toBe(2);
  });

  it('reports the success and reads the list once more when the dialog is closed during the confirmation', async () => {
    const { calls, remove } = serveRemoval();
    const { user } = renderUsers();
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.reads).toBeGreaterThan(0));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.lists).toBe(1);
    remove();

    expect(
      await screen.findByText(
        'User "zz-ann" has been successfully deleted.',
        {},
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('zz-ann')).toBeNull());
    expect(calls.lists).toBe(2);
    expect(calls.deletes).toHaveLength(1);
  });

  it('keeps the rows and reports the failure when the delete is refused', async () => {
    server.use(
      listOf(USERS, [ann, bob]).handler,
      http.delete(`*${USERS}41/`, () =>
        HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
      ),
    );
    const { user } = renderUsers();
    const dialog = await openDeleteDialog(user);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('User "zz-ann" could not be deleted.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You do not have permission to do this.'),
    ).toBeInTheDocument();
    expect(screen.getByText('zz-ann')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
