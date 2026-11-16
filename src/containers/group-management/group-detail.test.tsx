import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { type ReactElement } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { group, listOf, page, user } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import GroupDetail from './group-detail';

// The group screen starts its reads from lifecycle and click code, shows a
// refused member list as a page inside the Users tab, and removes a member
// through the group's own member endpoint. Pulp decides every request.

const API = '/pulp/api/v3';
const GROUP = group({ id: 7, name: 'zz-ops' });
const GROUP_PATH = `${API}/groups/7/`;
const MEMBERS = `${GROUP_PATH}users/`;
const USERS = `${API}/users/`;

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

const member = (id: number, username: string) =>
  user({ id, username, pulp_href: `${API}/users/${id}/` });

const serveMembers = (...members: ReturnType<typeof member>[]) => {
  const served = listOf(MEMBERS, members);
  server.use(served.handler);
  return served;
};

const answerWith = (path: string, status: number, body = { detail: 'No.' }) =>
  server.use(http.get(`*${path}`, () => HttpResponse.json(body, { status })));

function renderDetail(query = 'tab=users') {
  const ui: ReactElement = (
    <AppContextProvider>
      <PermissionsKnown>
        <Routes>
          <Route path='/groups/detail/:group' element={<GroupDetail />} />
        </Routes>
      </PermissionsKnown>
    </AppContextProvider>
  );
  const view = renderWithProviders(ui, {
    route: `/groups/detail/7?${query}`,
  });

  // unrelated re-renders of the screen, as a parent or an alert causes them
  const rerender = async () => {
    for (let i = 0; i < 3; i += 1) {
      view.rerender(ui);
    }
    await pause();
  };

  return { ...view, rerender };
}

describe('the members read of the users tab', () => {
  it("shows the insufficient permissions page with Pulp's reason when the read is refused, and sends the request once", async () => {
    answerWith(MEMBERS, 403);
    const view = renderDetail();

    await screen.findByRole('heading', {
      name: 'Insufficient permissions',
      level: 4,
    });
    expect(screen.getByText('No.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'zz-ops', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    await view.rerender();

    expect(count(`GET ${MEMBERS}`)).toBe(1);
    expect(alerts()).toBe(0);
  });

  it('shows one alert and a retryable error state when the read fails, and sends the request once until Retry', async () => {
    answerWith(MEMBERS, 500);
    const view = renderDetail();

    expect(
      await screen.findByRole('button', { name: 'Retry' }),
    ).toBeInTheDocument();
    expect(alerts()).toBe(1);

    await view.rerender();

    expect(count(`GET ${MEMBERS}`)).toBe(1);
    expect(alerts()).toBe(1);

    serveMembers(member(21, 'zz-ann'));
    await view.user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('zz-ann')).toBeInTheDocument();
    expect(count(`GET ${MEMBERS}`)).toBe(2);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('keeps the header and the tabs while the members load', async () => {
    server.use(
      http.get(`*${MEMBERS}`, async () => {
        await delay(60);
        return HttpResponse.json(page([member(21, 'zz-ann')]));
      }),
    );
    renderDetail();

    expect(
      await screen.findByRole('heading', { name: 'zz-ops', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('zz-ann')).toBeInTheDocument();
    expect(count(`GET ${MEMBERS}`)).toBe(1);
  });

  it('passes the page size and the sort of the tab to the members endpoint', async () => {
    const served = serveMembers(member(21, 'zz-ann'));
    renderDetail('tab=users&page_size=20&sort=-username');

    await screen.findByText('zz-ann');

    const [query] = served.queries;
    expect(query.get('limit')).toBe('20');
    expect(query.get('offset')).toBe('0');
    expect(query.get('ordering')).toBe('-username');
  });

  it('passes the username filter to the members endpoint', async () => {
    const served = serveMembers(member(21, 'zz-ann'), member(22, 'zz-bob'));
    const { user: person } = renderDetail();
    await screen.findByText('zz-ann');

    await person.type(
      screen.getByRole('textbox', { name: 'username' }),
      'zz-b',
    );
    await person.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(served.queries.length).toBe(2));
    expect(served.queries[1].get('username')).toBe('zz-b');
  });
});

describe('the add dialog of the users tab', () => {
  const candidates = () =>
    server.use(
      listOf(USERS, [member(21, 'zz-ann'), member(22, 'zz-cat')]).handler,
    );

  it('reads the user options once for each opening and not again on a re-render', async () => {
    serveMembers(member(21, 'zz-ann'));
    candidates();
    const view = renderDetail();
    await screen.findByText('zz-ann');
    expect(count(`GET ${USERS}`)).toBe(0);

    await view.user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByRole('combobox', { name: 'Select users' });
    await view.rerender();
    expect(count(`GET ${USERS}`)).toBe(1);

    await view.user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Cancel',
      }),
    );
    await view.rerender();
    expect(count(`GET ${USERS}`)).toBe(1);

    await view.user.click(screen.getByRole('button', { name: 'Add' }));
    await screen.findByRole('combobox', { name: 'Select users' });
    expect(count(`GET ${USERS}`)).toBe(2);
  });

  it('offers the users who are not members yet', async () => {
    serveMembers(member(21, 'zz-ann'));
    candidates();
    const view = renderDetail();
    await screen.findByText('zz-ann');

    await view.user.click(screen.getByRole('button', { name: 'Add' }));
    await view.user.click(
      await screen.findByRole('combobox', { name: 'Select users' }),
    );

    expect(await screen.findByRole('option', { name: /zz-cat/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /zz-ann/ })).toBeNull();
  });

  it('shows one alert, closes the dialog and sends the read once when the options cannot be read', async () => {
    serveMembers(member(21, 'zz-ann'));
    answerWith(USERS, 500);
    const view = renderDetail();
    await screen.findByText('zz-ann');

    await view.user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(alerts()).toBe(1));
    await view.rerender();

    expect(count(`GET ${USERS}`)).toBe(1);
    expect(alerts()).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the delete group dialog', () => {
  it('reads the members once when it opens, not before and not again on a re-render', async () => {
    server.use(
      http.get(`*${GROUP_PATH}roles/`, () => HttpResponse.json(page([]))),
    );
    serveMembers(member(21, 'zz-ann'));
    const view = renderDetail('tab=access');
    await screen.findByRole('heading', { name: 'zz-ops', level: 1 });
    await pause();
    expect(count(`GET ${MEMBERS}`)).toBe(0);

    await view.user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('Delete group?');
    await view.rerender();

    expect(await screen.findByText('zz-ann')).toBeInTheDocument();
    expect(count(`GET ${MEMBERS}`)).toBe(1);
  });

  it('reads the members once when that read fails', async () => {
    server.use(
      http.get(`*${GROUP_PATH}roles/`, () => HttpResponse.json(page([]))),
    );
    answerWith(MEMBERS, 500);
    const view = renderDetail('tab=access');
    await screen.findByRole('heading', { name: 'zz-ops', level: 1 });

    await view.user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(alerts()).toBe(1));
    await view.rerender();

    expect(count(`GET ${MEMBERS}`)).toBe(1);
    expect(alerts()).toBe(1);
  });
});

describe('removing a member', () => {
  async function openRemoval(view: ReturnType<typeof renderDetail>) {
    const row = await screen.findByText('zz-ann');
    await view.user.click(
      within(row.closest('tr')).getByRole('button', { name: /actions|kebab/i }),
    );
    await view.user.click(
      await screen.findByRole('menuitem', { name: 'Remove' }),
    );
    await screen.findByText('Remove user from group?');
  }

  const confirm = (view: ReturnType<typeof renderDetail>) =>
    view.user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );

  it('sends DELETE to the group member endpoint and never PUT to the user', async () => {
    serveMembers(member(21, 'zz-ann'));
    server.use(
      http.delete(`*${MEMBERS}21/`, async () => {
        await delay(120);
        server.use(listOf(MEMBERS, []).handler);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const view = renderDetail();
    await openRemoval(view);

    await confirm(view);

    // the row still lists the member until Pulp has answered
    expect(
      document.querySelector('[data-cy="GroupDetail-users-zz-ann"]'),
    ).not.toBeNull();
    expect(count(`DELETE ${MEMBERS}21/`)).toBe(1);

    expect(await screen.findByText('No users yet')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'User "zz-ann" has been successfully removed from group "zz-ops".',
      ),
    ).toBeInTheDocument();
    expect(count(`GET ${MEMBERS}`)).toBe(2);
    expect(requests.filter((r) => r.startsWith('PUT '))).toEqual([]);
  });

  it('shows one alert with the reason and keeps the member when Pulp refuses', async () => {
    serveMembers(member(21, 'zz-ann'));
    server.use(
      http.delete(`*${MEMBERS}21/`, () =>
        HttpResponse.json({ detail: 'No.' }, { status: 403 }),
      ),
    );
    const view = renderDetail();
    await openRemoval(view);

    await confirm(view);

    expect(
      await screen.findByText(
        'User "zz-ann" could not be removed from group "zz-ops".',
      ),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-cy="GroupDetail-users-zz-ann"]'),
    ).not.toBeNull();
    expect(requests.filter((r) => r.startsWith('PUT '))).toEqual([]);
  });

  it('shows no alert and keeps the confirmation open when the session ended', async () => {
    serveMembers(member(21, 'zz-ann'));
    server.use(
      http.delete(`*${MEMBERS}21/`, () =>
        HttpResponse.json({ detail: 'No.' }, { status: 401 }),
      ),
    );
    const view = renderDetail();
    await openRemoval(view);

    await confirm(view);
    await pause();

    expect(alerts()).toBe(0);
    expect(screen.getByText('Remove user from group?')).toBeInTheDocument();
  });
});

describe('the Remove control of the users tab', () => {
  async function renderFor(held: string[]) {
    permissions.stop();
    requests = [];
    permissions = servePermissions({ id: 1, own: [held] });
    server.events.on('request:start', ({ request }) => {
      requests.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    serveMembers(member(21, 'zz-ann'));
    const view = renderDetail();
    const row = await screen.findByText('zz-ann');
    return { view, row };
  }

  it('is offered with the permission to change the group', async () => {
    const { row } = await renderFor([
      'auth.view_user',
      'core.view_group',
      'core.change_group',
    ]);

    expect(
      within(row.closest('tr')).getByRole('button', { name: /actions|kebab/i }),
    ).toBeInTheDocument();
  });

  it('is not offered without it', async () => {
    const { row } = await renderFor(['auth.view_user', 'core.view_group']);

    expect(
      within(row.closest('tr')).queryByRole('button', {
        name: /actions|kebab/i,
      }),
    ).toBeNull();
  });
});
