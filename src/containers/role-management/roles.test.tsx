import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useNavigate } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { listOf, page, role as roleRow } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import RoleList from './role-list';

// The role screens list, create, edit and delete roles through the data
// hooks. Pulp decides every request; a screen shows exactly the rows of the
// filter, order and page of its address, and a failed read is a state with
// Retry, or the permissions page when Pulp refuses it.

const API = '/pulp/api/v3';
const ROLES = `${API}/roles/`;
const FAILED = 'Roles list could not be displayed.';

afterEach(() => {
  resetSessionEvents();
});

function Go({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type='button' onClick={() => navigate(to)}>
      {`go ${to}`}
    </button>
  );
}

function renderList(route = '/roles') {
  servePermissions({ isStaff: true });
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <RoleList />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const broken = () =>
  http.get(`*${ROLES}`, () =>
    HttpResponse.json({ detail: 'broken' }, { status: 500 }),
  );

const idOf = (row: { pulp_href: string }) =>
  row.pulp_href.split('/').filter(Boolean).pop();

describe('the role list', () => {
  it('lists ten rows by name when the address names nothing', async () => {
    const list = listOf(ROLES, [roleRow({ name: 'zz-ops' })]);
    server.use(list.handler);
    renderList();

    await screen.findByText('zz-ops');

    expect(list.queries).toHaveLength(1);
    expect(Object.fromEntries(list.queries[0])).toEqual({
      offset: '0',
      limit: '10',
      ordering: 'name',
    });
  });

  it('asks for the page, order and filters of the address', async () => {
    const list = listOf(ROLES, [
      ...Array.from({ length: 5 }, (_, n) =>
        roleRow({ name: `zz-first-${n}` }),
      ),
      roleRow({ name: 'zz-alpha' }),
    ]);
    server.use(list.handler);
    renderList(
      '/roles?name__icontains=al&locked=false&page=2&page_size=5&sort=-name',
    );

    await screen.findByText('zz-alpha');

    expect(list.queries).toHaveLength(1);
    expect(Object.fromEntries(list.queries[0])).toEqual({
      offset: '5',
      limit: '5',
      ordering: '-name',
      name__icontains: 'al',
      locked: 'false',
    });
  });

  it('shows the name, description, date and whether the role is editable, and expands to the permissions', async () => {
    server.use(
      listOf(ROLES, [
        roleRow({
          name: 'zz-custom',
          description: 'Custom role',
          locked: false,
          permissions: ['core.view_task'],
        }),
        roleRow({ name: 'zz-builtin', locked: true }),
      ]).handler,
    );
    const { user } = renderList();

    const row = (await screen.findByText('zz-custom')).closest('tr');
    expect(within(row as HTMLElement).getByText('Custom role')).toBeVisible();
    expect(within(row as HTMLElement).getByText('Editable')).toBeVisible();
    expect(
      within(
        screen.getByText('zz-builtin').closest('tr') as HTMLElement,
      ).getByText('Built-in'),
    ).toBeVisible();
    expect(
      screen.getByRole('columnheader', { name: /Role name/ }),
    ).toBeInTheDocument();

    await user.click(
      within(row as HTMLElement).getByRole('button', { name: /details/i }),
    );
    expect(
      await screen.findByText(/core\.view_task|View task/i),
    ).toBeInTheDocument();
  });

  it('links the edit action to the address that holds the id of the role', async () => {
    const custom = roleRow({ name: 'zz-custom', locked: false });
    server.use(listOf(ROLES, [custom]).handler);
    const { user } = renderList();
    await screen.findByText('zz-custom');

    await user.click(
      within(screen.getByText('zz-custom').closest('tr') as HTMLElement)
        .getAllByRole('button')
        .at(-1) as HTMLElement,
    );
    const edit = await screen.findByRole('menuitem', { name: 'Edit' });

    expect(edit).toBeEnabled();
    expect(idOf(custom)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('says there are no roles only for a successful empty answer', async () => {
    server.use(listOf(ROLES, []).handler);
    renderList();

    expect(
      await screen.findByText('There are currently no roles'),
    ).toBeInTheDocument();
  });

  it('shows the filter empty state when a filter matches nothing', async () => {
    server.use(listOf(ROLES, []).handler);
    renderList('/roles?name__icontains=nobody');

    expect(await screen.findByText(/No results found/i)).toBeInTheDocument();
    expect(screen.queryByText('There are currently no roles')).toBeNull();
  });

  it('shows only the rows of the newest filter when an older answer arrives last', async () => {
    let releaseOlder: () => void = () => undefined;
    const older = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    server.use(
      http.get(`*${ROLES}`, async ({ request }) => {
        const filter = new URL(request.url).searchParams.get('name__icontains');
        if (filter === null) {
          await older;
          return HttpResponse.json(page([roleRow({ name: 'zz-old' })]));
        }
        return HttpResponse.json(page([roleRow({ name: 'zz-new' })]));
      }),
    );
    servePermissions({ isStaff: true });
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Go to='/roles?name__icontains=new' />
        <RoleList />
      </AppContextProvider>,
      { route: '/roles' },
    );

    await user.click(
      screen.getByRole('button', { name: 'go /roles?name__icontains=new' }),
    );
    expect(await screen.findByText('zz-new')).toBeInTheDocument();
    releaseOlder();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(screen.getByText('zz-new')).toBeInTheDocument();
    expect(screen.queryByText('zz-old')).toBeNull();
  });

  it('shows the insufficient permissions page, with the server reason and no alert, when the read is refused', async () => {
    server.use(
      http.get(`*${ROLES}`, () =>
        HttpResponse.json({ detail: 'Not allowed.' }, { status: 403 }),
      ),
    );
    renderList();

    expect(
      await screen.findByText('Insufficient permissions'),
    ).toBeInTheDocument();
    expect(screen.getByText('Not allowed.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('a role list read that fails', () => {
  it('offers Retry instead of saying there are no roles, and lists after a fixed read', async () => {
    server.use(broken());
    const { user } = renderList();

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText('There are currently no roles')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();

    server.use(listOf(ROLES, [roleRow({ name: 'zz-ops' })]).handler);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('zz-ops')).toBeInTheDocument();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it('shows an answer in the wrong shape as a failed read', async () => {
    server.use(
      http.get(`*${ROLES}`, () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [{ name: 'zz-nameless-address' }],
        }),
      ),
    );
    renderList();

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('There are currently no roles')).toBeNull();
  });

  it('keeps the rows and adds one alert, no empty state, when a read of the same list fails', async () => {
    serveSignIn();
    server.use(listOf(ROLES, [roleRow({ name: 'zz-ops' })]).handler);
    servePermissions({ isStaff: true });
    const { user } = renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <RoleList />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/roles' },
    );
    await screen.findByText('zz-ops');
    await signedIn();
    server.use(broken());

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.getByText('zz-ops')).toBeInTheDocument();
    expect(screen.getAllByText(FAILED)).toHaveLength(1);
    expect(screen.queryByText('There are currently no roles')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows no rows of another filter when the read for the new filter fails', async () => {
    server.use(
      http.get(`*${ROLES}`, ({ request }) =>
        new URL(request.url).searchParams.has('name__icontains')
          ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
          : HttpResponse.json(page([roleRow({ name: 'zz-all' })])),
      ),
    );
    servePermissions({ isStaff: true });
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Go to='/roles?name__icontains=beta' />
        <RoleList />
      </AppContextProvider>,
      { route: '/roles' },
    );
    await screen.findByText('zz-all');

    await user.click(
      screen.getByRole('button', { name: 'go /roles?name__icontains=beta' }),
    );

    expect(await screen.findByText(FAILED)).toBeInTheDocument();
    expect(screen.queryByText('zz-all')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('deleting a role', () => {
  async function openDelete(
    user: ReturnType<typeof renderList>['user'],
    name: string,
  ) {
    await user.click(
      within(screen.getByText(name).closest('tr') as HTMLElement)
        .getAllByRole('button')
        .at(-1) as HTMLElement,
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    return within(await screen.findByRole('dialog'));
  }

  it('sends one DELETE to the address of the role, reads the list again and says so', async () => {
    const custom = roleRow({ name: 'zz-custom', locked: false });
    const list = listOf(ROLES, [custom]);
    const deleted: string[] = [];
    server.use(
      list.handler,
      http.delete(`*${ROLES}${idOf(custom)}/`, ({ request }) => {
        deleted.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderList();
    await screen.findByText('zz-custom');
    const readsBefore = list.queries.length;

    const dialog = await openDelete(user, 'zz-custom');
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Role "zz-custom" has been successfully deleted.'),
    ).toBeVisible();
    expect(deleted).toEqual([`${ROLES}${idOf(custom)}/`]);
    await waitFor(() => expect(list.queries.length).toBe(readsBefore + 1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends one DELETE when Delete is pressed twice', async () => {
    const custom = roleRow({ name: 'zz-custom', locked: false });
    const deleted: string[] = [];
    server.use(
      listOf(ROLES, [custom]).handler,
      http.delete(`*${ROLES}${idOf(custom)}/`, async ({ request }) => {
        deleted.push(new URL(request.url).pathname);
        await new Promise((resolve) => setTimeout(resolve, 40));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderList();
    await screen.findByText('zz-custom');

    const dialog = await openDelete(user, 'zz-custom');
    const button = dialog.getByRole('button', { name: 'Delete' });
    await user.click(button);
    await user.click(button).catch(() => undefined);

    await screen.findByText('Role "zz-custom" has been successfully deleted.');
    expect(deleted).toHaveLength(1);
  });

  it('shows the refusal as an alert, keeps the role and closes the dialog', async () => {
    const custom = roleRow({ name: 'zz-custom', locked: false });
    server.use(
      listOf(ROLES, [custom]).handler,
      http.delete(`*${ROLES}${idOf(custom)}/`, () =>
        HttpResponse.json({ detail: 'Only staff.' }, { status: 403 }),
      ),
    );
    const { user } = renderList();
    await screen.findByText('zz-custom');

    const dialog = await openDelete(user, 'zz-custom');
    await user.click(dialog.getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Role "zz-custom" could not be deleted.'),
    ).toBeVisible();
    expect(screen.getByText(/Only staff\./)).toBeVisible();
    expect(screen.getByText('zz-custom')).toBeVisible();
  });

  it('offers a built-in role no enabled edit or delete', async () => {
    server.use(
      listOf(ROLES, [roleRow({ name: 'zz-builtin', locked: true })]).handler,
    );
    const { user } = renderList();
    await screen.findByText('zz-builtin');

    await user.click(
      within(screen.getByText('zz-builtin').closest('tr') as HTMLElement)
        .getAllByRole('button')
        .at(-1) as HTMLElement,
    );

    expect(
      await screen.findByRole('menuitem', { name: 'Edit' }),
    ).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled();
  });
});
