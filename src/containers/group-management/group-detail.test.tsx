import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { type ReactElement } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { groupKeys } from 'src/entities/core/group/queries';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { group, listOf, page, user } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import GroupDetail from './group-detail';

// The group screen reads the group and its members through the data hooks,
// shows a refused member list as a page inside the Users tab, adds users that
// are not members of the group (judged against every member, not one page) and
// removes a member through the group's own member endpoint. The members
// endpoint of Pulp lists, and neither filters nor sorts: the tab does both.
// Pulp decides every request.

const API = '/pulp/api/v3';
const GROUP = group({
  id: 7,
  pulp_href: `${API}/groups/7/`,
  name: 'zz-ops',
});
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

// What the list screen of the application would show of the alerts another
// screen queued for it.
const QueuedAlerts = () => (
  <ul aria-label='queued alerts'>
    {(useAppContext().alerts ?? []).map((alert) => (
      <li key={String(alert.title)}>{alert.title}</li>
    ))}
  </ul>
);

function renderDetail(query = 'tab=users', address = '/groups/detail/7') {
  const ui: ReactElement = (
    <AppContextProvider>
      <PermissionsKnown>
        <Routes>
          <Route path='/groups/detail/:group' element={<GroupDetail />} />
          <Route
            path='/groups'
            element={
              <>
                <p>the list screen</p>
                <QueuedAlerts />
              </>
            }
          />
        </Routes>
      </PermissionsKnown>
    </AppContextProvider>
  );
  const view = renderWithProviders(ui, {
    route: `${address}?${query}`,
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

  it('reads every member once and cuts the page, the order and the filter of the tab from them', async () => {
    const served = serveMembers(
      ...Array.from({ length: 25 }, (_, i) =>
        member(100 + i, `zz-u${String(i).padStart(2, '0')}`),
      ),
    );
    renderDetail('tab=users&page_size=10&page=3&sort=-username');

    // the third page of ten, sorted down: the five smallest names
    expect(await screen.findByText('zz-u04')).toBeInTheDocument();
    expect(screen.getByText('zz-u00')).toBeInTheDocument();
    expect(screen.queryByText('zz-u05')).toBeNull();
    expect(count(`GET ${MEMBERS}`)).toBe(1);
    expect(served.queries[0].get('offset')).toBe('0');
  });

  it('shows only the members whose username contains the filter, without another request', async () => {
    serveMembers(member(21, 'zz-ann'), member(22, 'zz-bob'));
    const { user: person } = renderDetail();
    await screen.findByText('zz-ann');

    await person.type(
      screen.getByRole('textbox', { name: 'username' }),
      'zz-b',
    );
    await person.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(screen.queryByText('zz-ann')).toBeNull());
    expect(screen.getByText('zz-bob')).toBeInTheDocument();
    expect(count(`GET ${MEMBERS}`)).toBe(1);
  });

  it('shows the empty filter state, not the no-users state, when no member matches', async () => {
    serveMembers(member(21, 'zz-ann'));
    renderDetail('tab=users&username=nobody');

    expect(await screen.findByText('No results found')).toBeInTheDocument();
    expect(screen.queryByText('No users yet')).toBeNull();
  });

  it('reverses the order when the username column is pressed again', async () => {
    serveMembers(member(21, 'zz-ann'), member(22, 'zz-bob'));
    const view = renderDetail();
    await screen.findByText('zz-ann');
    const names = () =>
      Array.from(
        document.querySelectorAll('[data-cy^="GroupDetail-users-"]'),
      ).map((row) => row.getAttribute('data-cy'));
    expect(names()).toEqual([
      'GroupDetail-users-zz-ann',
      'GroupDetail-users-zz-bob',
    ]);

    await view.user.click(
      view.container.querySelector('[data-cy="sort_username"]') as Element,
    );

    await waitFor(() =>
      expect(names()).toEqual([
        'GroupDetail-users-zz-bob',
        'GroupDetail-users-zz-ann',
      ]),
    );
  });

  it('shows no users yet, with Add, when the group has no member', async () => {
    serveMembers();
    renderDetail();

    expect(await screen.findByText('No users yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });
});

describe('the group read', () => {
  it('reads the group once by its address and shows its name and tabs', async () => {
    server.use(
      http.get(`*${GROUP_PATH}roles/`, () => HttpResponse.json(page([]))),
    );
    renderDetail('tab=access');

    expect(
      await screen.findByRole('heading', { name: 'zz-ops', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Access' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(count(`GET ${GROUP_PATH}`)).toBe(1);
  });

  it('shows the not found page, and sends no request, for an address that names no group', async () => {
    renderDetail('tab=access', '/groups/detail/zz-ops');

    expect(await screen.findByText('404 - Page not found')).toBeInTheDocument();
    expect(requests.filter((r) => r.includes('/groups/'))).toEqual([]);
  });

  it('shows the not found page for a group Pulp does not know', async () => {
    answerWith(GROUP_PATH, 404);
    renderDetail('tab=access');

    expect(await screen.findByText('404 - Page not found')).toBeInTheDocument();
    expect(alerts()).toBe(0);
  });

  it("shows the insufficient permissions page with Pulp's reason, no Retry and no alert, when the read is refused", async () => {
    answerWith(GROUP_PATH, 403);
    renderDetail('tab=access');

    await screen.findByRole('heading', {
      name: 'Insufficient permissions',
      level: 4,
    });
    expect(screen.getByText('No.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(alerts()).toBe(0);
    expect(count(`GET ${GROUP_PATH}`)).toBe(1);
  });

  it('shows a retryable error state, not a blank page, when the read fails, and reads again on Retry', async () => {
    answerWith(GROUP_PATH, 500);
    const view = renderDetail('tab=access');

    expect(
      await screen.findByText('Group could not be displayed.'),
    ).toBeInTheDocument();
    server.use(
      http.get(`*${GROUP_PATH}`, () => HttpResponse.json(GROUP)),
      http.get(`*${GROUP_PATH}roles/`, () => HttpResponse.json(page([]))),
    );

    await view.user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('heading', { name: 'zz-ops', level: 1 }),
    ).toBeInTheDocument();
    expect(count(`GET ${GROUP_PATH}`)).toBe(2);
  });
});

describe('the add dialog of the users tab', () => {
  const candidates = (...names: string[]) =>
    server.use(
      listOf(
        USERS,
        names.map((name, i) => member(21 + i, name)),
      ).handler,
    );

  const openDialog = async (view: ReturnType<typeof renderDetail>) => {
    await view.user.click(screen.getByRole('button', { name: 'Add' }));
    await view.user.click(
      await screen.findByRole('combobox', { name: 'Select users' }),
    );
  };

  const choose = async (view: ReturnType<typeof renderDetail>, name: RegExp) =>
    view.user.click(await screen.findByRole('option', { name }));

  const confirmAdd = (view: ReturnType<typeof renderDetail>) =>
    view.user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }),
    );

  it('reads the user options once for each opening and not again on a re-render', async () => {
    serveMembers(member(21, 'zz-ann'));
    candidates('zz-ann', 'zz-cat');
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
    candidates('zz-ann', 'zz-cat');
    const view = renderDetail();
    await screen.findByText('zz-ann');

    await openDialog(view);

    expect(await screen.findByRole('option', { name: /zz-cat/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /zz-ann/ })).toBeNull();
  });

  it('does not offer a member that is on another page than the one the tab shows', async () => {
    const fifteen = Array.from({ length: 15 }, (_, i) =>
      member(100 + i, `zz-m${String(i).padStart(2, '0')}`),
    );
    server.use(listOf(MEMBERS, fifteen, { pageSize: 10 }).handler);
    candidates('zz-m00', 'zz-m14', 'zz-new');
    const view = renderDetail('tab=users&page_size=10');
    await screen.findByText('zz-m00');
    // zz-m14 is a member on the second page, which the tab does not show
    expect(screen.queryByText('zz-m14')).toBeNull();

    await openDialog(view);

    expect(await screen.findByRole('option', { name: /zz-new/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /zz-m14/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /zz-m00/ })).toBeNull();
  });

  it('judges the options against the members as they are now, not as the tab read them', async () => {
    serveMembers(member(21, 'zz-ann'));
    candidates('zz-ann', 'zz-cat');
    const view = renderDetail();
    await screen.findByText('zz-ann');
    // somebody else added zz-cat after the tab was read
    serveMembers(member(21, 'zz-ann'), member(22, 'zz-cat'));
    candidates('zz-ann', 'zz-cat', 'zz-dan');

    await openDialog(view);

    expect(await screen.findByRole('option', { name: /zz-dan/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /zz-cat/ })).toBeNull();
  });

  it('searches the users through the user list with the typed text and offers the answer', async () => {
    serveMembers(member(21, 'zz-ann'));
    const everyone = listOf(
      USERS,
      [member(31, 'zz-bea'), member(32, 'zz-cat'), member(33, 'zz-ann')],
      {
        matching: (row, query) =>
          row.username.includes(query.get('username__contains') ?? ''),
      },
    );
    server.use(everyone.handler);
    const view = renderDetail();
    await screen.findByText('zz-ann');
    await openDialog(view);
    await screen.findByRole('option', { name: /zz-bea/ });

    await view.user.type(screen.getByRole('combobox'), 'cat');

    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /zz-bea/ })).toBeNull(),
    );
    expect(screen.getByRole('option', { name: /zz-cat/ })).toBeTruthy();
    const search = everyone.queries.at(-1);
    expect(search?.get('username__contains')).toBe('cat');
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

  it('shows one alert and closes the dialog when the members cannot be read, so nobody is offered on a guess', async () => {
    serveMembers(member(21, 'zz-ann'));
    candidates('zz-ann', 'zz-cat');
    const view = renderDetail();
    await screen.findByText('zz-ann');
    answerWith(MEMBERS, 500);

    await view.user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(alerts()).toBe(1));
    await view.rerender();

    expect(alerts()).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends one POST for each chosen user, reads the members again once they all settled and closes', async () => {
    serveMembers(member(21, 'zz-ann'));
    candidates('zz-ann', 'zz-cat', 'zz-dan');
    const posts: unknown[] = [];
    server.use(
      http.post(`*${MEMBERS}`, async ({ request }) => {
        posts.push(await request.json());
        await delay(30);
        return HttpResponse.json({ username: 'x' }, { status: 201 });
      }),
    );
    const view = renderDetail();
    await screen.findByText('zz-ann');
    await openDialog(view);
    await choose(view, /zz-cat/);
    await choose(view, /zz-dan/);
    const membersBefore = count(`GET ${MEMBERS}`);

    await confirmAdd(view);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts).toEqual([{ username: 'zz-cat' }, { username: 'zz-dan' }]);
    expect(
      screen.getByText(
        'User "zz-cat" has been successfully added to group "zz-ops".',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'User "zz-dan" has been successfully added to group "zz-ops".',
      ),
    ).toBeInTheDocument();
    // the tab's own read, and the dialog's read of the names, happened before
    expect(count(`GET ${MEMBERS}`)).toBeGreaterThan(membersBefore);
  });

  it('sends one POST per press when Add is pressed twice while the request is under way', async () => {
    serveMembers(member(21, 'zz-ann'));
    candidates('zz-ann', 'zz-cat');
    server.use(
      http.post(`*${MEMBERS}`, async () => {
        await delay(100);
        return HttpResponse.json({ username: 'x' }, { status: 201 });
      }),
    );
    const view = renderDetail();
    await screen.findByText('zz-ann');
    await openDialog(view);
    await choose(view, /zz-cat/);

    await confirmAdd(view);
    await confirmAdd(view);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(count(`POST ${MEMBERS}`)).toBe(1);
  });

  it('shows the answer of Pulp as an alert and closes the dialog when the user is a member already', async () => {
    serveMembers(member(21, 'zz-ann'));
    candidates('zz-ann', 'zz-cat');
    server.use(
      http.post(`*${MEMBERS}`, () =>
        HttpResponse.json(
          { detail: 'User is already in the group.' },
          { status: 400 },
        ),
      ),
    );
    const view = renderDetail();
    await screen.findByText('zz-ann');
    await openDialog(view);
    await choose(view, /zz-cat/);

    await confirmAdd(view);

    expect(
      await screen.findByText(
        'User "zz-cat" could not be added to group "zz-ops".',
      ),
    ).toBeInTheDocument();
    expect(alerts()).toBe(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports each user on its own when one of two cannot be added', async () => {
    serveMembers(member(21, 'zz-ann'));
    candidates('zz-ann', 'zz-cat', 'zz-dan');
    server.use(
      http.post(`*${MEMBERS}`, async ({ request }) => {
        const { username } = (await request.json()) as { username: string };
        return username === 'zz-dan'
          ? HttpResponse.json({ detail: 'No.' }, { status: 403 })
          : HttpResponse.json({ username }, { status: 201 });
      }),
    );
    const view = renderDetail();
    await screen.findByText('zz-ann');
    await openDialog(view);
    await choose(view, /zz-cat/);
    await choose(view, /zz-dan/);

    await confirmAdd(view);

    expect(
      await screen.findByText(
        'User "zz-dan" could not be added to group "zz-ops".',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'User "zz-cat" has been successfully added to group "zz-ops".',
      ),
    ).toBeInTheDocument();
  });

  it('shows no alert and keeps the dialog with the chosen user when the session ended', async () => {
    serveMembers(member(21, 'zz-ann'));
    candidates('zz-ann', 'zz-cat');
    server.use(
      http.post(`*${MEMBERS}`, () =>
        HttpResponse.json({ detail: 'No.' }, { status: 401 }),
      ),
    );
    const view = renderDetail();
    await screen.findByText('zz-ann');
    await openDialog(view);
    await choose(view, /zz-cat/);

    await confirmAdd(view);
    await pause();

    expect(alerts()).toBe(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      within(screen.getByRole('dialog')).getByText('zz-cat'),
    ).toBeInTheDocument();
  });
});

describe('the delete group dialog', () => {
  const noRoles = () =>
    server.use(
      http.get(`*${GROUP_PATH}roles/`, () => HttpResponse.json(page([]))),
    );

  it('reads the members once when it opens, not before and not again on a re-render', async () => {
    noRoles();
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
    noRoles();
    answerWith(MEMBERS, 500);
    const view = renderDetail('tab=access');
    await screen.findByRole('heading', { name: 'zz-ops', level: 1 });

    await view.user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(alerts()).toBe(1));
    await view.rerender();

    expect(count(`GET ${MEMBERS}`)).toBe(1);
    expect(alerts()).toBe(1);
  });

  it('warns that the users cannot be shown, with no alert, when Pulp refuses to list the members', async () => {
    noRoles();
    answerWith(MEMBERS, 403);
    const view = renderDetail('tab=access');
    await screen.findByRole('heading', { name: 'zz-ops', level: 1 });

    await view.user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(
      await screen.findByText('This group can include users'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Users list could not be displayed.')).toBeNull();
    expect(count(`GET ${MEMBERS}`)).toBe(1);
  });

  async function confirmDelete(view: ReturnType<typeof renderDetail>) {
    await view.user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('Delete group?');
    await view.user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
  }

  it('sends one DELETE, queues the success alert for the list and moves to the list without reading the deleted group again', async () => {
    noRoles();
    serveMembers();
    server.use(
      http.delete(`*${GROUP_PATH}`, async () => {
        await delay(60);
        // the group is gone from here on
        server.use(
          http.get(`*${GROUP_PATH}`, () =>
            HttpResponse.json({ detail: 'Not found.' }, { status: 404 }),
          ),
        );
        return new HttpResponse(null, { status: 204 });
      }),
      listOf(`${API}/groups/`, []).handler,
    );
    const view = renderDetail('tab=access');
    await screen.findByRole('heading', { name: 'zz-ops', level: 1 });

    await confirmDelete(view);
    // pressing Delete again while the request is under way sends nothing more
    await view.user.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: /Delete/,
      }),
    );
    expect(await screen.findByText('the list screen')).toBeInTheDocument();

    expect(count(`DELETE ${GROUP_PATH}`)).toBe(1);
    expect(count(`GET ${GROUP_PATH}`)).toBe(1);
    // the deleted group does not come back from what was read of it
    expect(
      view.queryClient.getQueryData(groupKeys.detail(`${API}/groups/7/`)),
    ).toBeUndefined();
    expect(
      within(screen.getByRole('list', { name: 'queued alerts' })).getByText(
        'Group "zz-ops" has been successfully deleted.',
      ),
    ).toBeInTheDocument();
  });

  it('stays on the group with one alert that names the group when Pulp refuses', async () => {
    noRoles();
    serveMembers();
    server.use(
      http.delete(`*${GROUP_PATH}`, () =>
        HttpResponse.json({ detail: 'No.' }, { status: 403 }),
      ),
    );
    const view = renderDetail('tab=access');
    await screen.findByRole('heading', { name: 'zz-ops', level: 1 });

    await confirmDelete(view);

    expect(
      await screen.findByText('Group "zz-ops" could not be deleted.'),
    ).toBeInTheDocument();
    expect(alerts()).toBe(1);
    // the confirmation stays, so that the user can try again
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('the list screen')).toBeNull();
    expect(count(`DELETE ${GROUP_PATH}`)).toBe(1);
  });

  it('shows no alert and stays when the session ended', async () => {
    noRoles();
    serveMembers();
    server.use(
      http.delete(`*${GROUP_PATH}`, () =>
        HttpResponse.json({ detail: 'No.' }, { status: 401 }),
      ),
    );
    const view = renderDetail('tab=access');
    await screen.findByRole('heading', { name: 'zz-ops', level: 1 });

    await confirmDelete(view);
    await pause();

    expect(alerts()).toBe(0);
    expect(screen.queryByText('the list screen')).toBeNull();
    expect(count(`DELETE ${GROUP_PATH}`)).toBe(1);
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
