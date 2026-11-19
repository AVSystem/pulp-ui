import { act, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useNavigate } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { groupPage, groupRow, listOf } from 'src/test-utils/pulp';
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
    const row = groupRow({ id: 31, name: 'zz-ops' });
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
