import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { group, listOf } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import GroupDetail from '../group-detail';

// The roles tab of the group screen lists, adds and removes the roles of one
// group through the data hooks. Pulp decides every request; the tab shows
// exactly the rows of the filter, order and page of its address, and a failed
// read is a state with Retry, or the permissions page when Pulp refuses it.

const API = '/pulp/api/v3';
const GROUP = group({ id: 7, pulp_href: `${API}/groups/7/`, name: 'zz-ops' });
const GROUP_PATH = `${API}/groups/7/`;
const ROLES = `${GROUP_PATH}roles/`;

let requests: string[] = [];
let permissions: { stop: () => void };

beforeEach(() => {
  requests = [];
  permissions = servePermissions({ id: 1, isStaff: true });
  server.events.on('request:start', ({ request }) => {
    requests.push(`${request.method} ${new URL(request.url).pathname}`);
  });
  server.use(http.get(`*${GROUP_PATH}`, () => HttpResponse.json(GROUP)));
});

afterEach(() => {
  permissions.stop();
});

const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));

const count = (entry: string) => requests.filter((r) => r === entry).length;

const alerts = () => document.querySelectorAll('.pf-v6-c-alert').length;

// Pulp names a group role by a uuid; each test role gets a fixed one.
const ids: Record<string, string> = {};
const idOf = (role: string) =>
  (ids[role] ??= `0189c0de-0000-4000-8000-${String(
    Object.keys(ids).length + 1,
  ).padStart(12, '0')}`);

const groupRole = (role: string, over: Record<string, unknown> = {}) => ({
  pulp_href: `${ROLES}${idOf(role)}/`,
  pulp_created: '2000-01-01T00:00:00Z',
  role,
  description: `${role} description`,
  permissions: [],
  content_object: null,
  ...over,
});

const serveRoles = (...roles: string[]) => {
  const served = listOf(
    ROLES,
    roles.map((role) => groupRole(role)),
  );
  server.use(served.handler);
  return served;
};

let go: (query: string) => void = () => undefined;

const Navigator = () => {
  const navigate = useNavigate();
  go = (query) => navigate(`/groups/detail/7?${query}`);
  return null;
};

function renderTab(query = 'tab=access') {
  return renderWithProviders(
    <AppContextProvider>
      <Navigator />
      <PermissionsKnown>
        <Routes>
          <Route path='/groups/detail/:group' element={<GroupDetail />} />
        </Routes>
      </PermissionsKnown>
    </AppContextProvider>,
    { route: `/groups/detail/7?${query}` },
  );
}

const rowActions = (text: string) =>
  within(screen.getByText(text).closest('tr') as HTMLElement).getByRole(
    'button',
    { name: /actions|kebab/i },
  );

describe('the roles read of the group tab', () => {
  it('asks the roles of the group for the page, the order and the filter of the address', async () => {
    const served = serveRoles('zz-role-a');
    renderTab('tab=access&page=2&page_size=5&sort=-role&role__icontains=zz');

    await waitFor(() => expect(served.queries).toHaveLength(1));
    expect(Object.fromEntries(served.queries[0])).toEqual({
      offset: '5',
      limit: '5',
      ordering: '-role',
      role__icontains: 'zz',
      content_object: 'null',
    });
  });

  it('shows the rows of the newest filter even when an older answer arrives later', async () => {
    server.use(
      http.get(`*${ROLES}`, async ({ request }) => {
        const filter = new URL(request.url).searchParams.get('role__icontains');
        if (filter === 'old') {
          await delay(300);
          return HttpResponse.json({
            count: 1,
            next: null,
            previous: null,
            results: [groupRole('zz-from-old-filter')],
          });
        }
        return HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [groupRole(filter ? 'zz-from-new-filter' : 'zz-all')],
        });
      }),
    );
    renderTab();
    await screen.findByText('zz-all');

    // as the browser's Back and Forward buttons do: a newer address is
    // reached while the answer to the older one is still on its way
    act(() => go('tab=access&role__icontains=old'));
    await pause(20);
    act(() => go('tab=access&role__icontains=new'));

    expect(await screen.findByText('zz-from-new-filter')).toBeInTheDocument();
    await pause(450);
    expect(screen.getByText('zz-from-new-filter')).toBeInTheDocument();
    expect(screen.queryByText('zz-from-old-filter')).toBeNull();
  });

  it('shows the empty filter state, not the no-roles state, when nothing matches', async () => {
    serveRoles();
    renderTab('tab=access&role__icontains=nothing');

    expect(await screen.findByText('No results found')).toBeInTheDocument();
    expect(
      screen.queryByText(
        'There are currently no roles assigned to this group.',
      ),
    ).toBeNull();
  });

  it('shows the no-roles state when the group holds none', async () => {
    serveRoles();
    renderTab();

    expect(
      await screen.findByText(
        'There are currently no roles assigned to this group.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the failed state with Retry and one alert when the read fails, and reads again on Retry', async () => {
    server.use(
      http.get(`*${ROLES}`, () =>
        HttpResponse.json({}, { status: 500, statusText: 'Server Error' }),
      ),
    );
    const { user: person } = renderTab();

    expect(
      await screen.findByText('Roles list could not be displayed.'),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Permissions for group "zz-ops" could not be displayed.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('No roles yet')).toBeNull();
    expect(alerts()).toBe(1);
    expect(count(`GET ${ROLES}`)).toBe(1);

    serveRoles('zz-role-a');
    await person.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('zz-role-a')).toBeVisible();
    expect(screen.queryByText('Roles list could not be displayed.')).toBeNull();
  });

  it("shows the insufficient permissions page with Pulp's reason, no Retry and no alert, when the read is refused", async () => {
    server.use(
      http.get(`*${ROLES}`, () =>
        HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
      ),
    );
    renderTab();

    await screen.findByRole('heading', {
      name: 'Insufficient permissions',
      level: 4,
    });
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(alerts()).toBe(0);
    await pause();
    expect(count(`GET ${ROLES}`)).toBe(1);
  });
});

describe('removing a role from the group', () => {
  const confirm = async (person: ReturnType<typeof renderTab>['user']) => {
    await person.click(rowActions('zz-role-a'));
    await person.click(
      await screen.findByRole('menuitem', { name: 'Remove role' }),
    );
    await screen.findByText('Delete role: zz-role-a');
  };

  it('sends one DELETE to the role of the group, reads the roles again and says so', async () => {
    serveRoles('zz-role-a', 'zz-role-b');
    server.use(
      http.delete(`*${ROLES}${idOf('zz-role-a')}/`, () => {
        server.use(listOf(ROLES, [groupRole('zz-role-b')]).handler);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user: person } = renderTab();
    await screen.findByText('zz-role-a');
    await confirm(person);

    await person.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('zz-role-a')).toBeNull());
    expect(screen.getByText('zz-role-b')).toBeInTheDocument();
    expect(
      screen.getByText('Role "zz-role-a" has been successfully removed.'),
    ).toBeInTheDocument();
    expect(count(`DELETE ${ROLES}${idOf('zz-role-a')}/`)).toBe(1);
    expect(count(`GET ${ROLES}`)).toBe(2);
    expect(screen.queryByText('Delete role: zz-role-a')).toBeNull();
  });

  it('shows the refusal of Pulp as one alert, keeps the role and sends the request once', async () => {
    serveRoles('zz-role-a');
    server.use(
      http.delete(`*${ROLES}${idOf('zz-role-a')}/`, () =>
        HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
      ),
    );
    const { user: person } = renderTab();
    await screen.findByText('zz-role-a');
    await confirm(person);

    await person.click(screen.getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('Role "zz-role-a" could not be deleted.'),
    ).toBeInTheDocument();
    expect(screen.getByText('zz-role-a')).toBeInTheDocument();
    expect(alerts()).toBe(1);
    expect(count(`DELETE ${ROLES}${idOf('zz-role-a')}/`)).toBe(1);
  });

  it('sends one DELETE for two presses of Delete', async () => {
    serveRoles('zz-role-a');
    server.use(
      http.delete(`*${ROLES}${idOf('zz-role-a')}/`, async () => {
        await delay(150);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user: person } = renderTab();
    await screen.findByText('zz-role-a');
    await confirm(person);
    const press = screen.getByRole('button', { name: 'Delete' });

    await person.click(press);
    await person.click(press);
    await pause(300);

    expect(count(`DELETE ${ROLES}${idOf('zz-role-a')}/`)).toBe(1);
  });
});
