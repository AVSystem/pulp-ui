import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import {
  type IPermissionSetup,
  PermissionsKnown,
  servePermissions,
} from 'src/test-utils/permissions';
import { listOf } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import UserProfile from './user-profile';

// A user who holds no permission on the user list still reads their own
// record, because Pulp answers a read of one's own record by its address. The
// list of users is not asked for: Pulp refuses it to such a user.

const API = '/pulp/api/v3';

let recorder: { requests: string[]; stop: () => void };

afterEach(() => {
  recorder.stop();
  resetSessionEvents();
});

describe('the profile page of a user who may not list users', () => {
  function renderProfile(
    setup: IPermissionSetup = {},
    { waitForPermissions = true } = {},
  ) {
    recorder = servePermissions({
      id: 7,
      username: 'zoe',
      isStaff: false,
      ...setup,
    });
    server.use(
      // the group selector of the user form reads the first groups as it opens
      listOf(`${API}/groups/`, []).handler,
      http.get(`*${API}/users/`, () =>
        HttpResponse.json(
          { detail: 'You do not have permission to perform this action.' },
          { status: 403, statusText: 'Forbidden' },
        ),
      ),
      http.get(`*${API}/users/7/`, () =>
        HttpResponse.json({
          pulp_href: `${API}/users/7/`,
          id: 7,
          username: 'zoe',
          first_name: 'Zo',
          last_name: '',
          email: '',
          is_staff: setup.isStaff ?? false,
          is_active: true,
          date_joined: '2000-01-01T00:00:00.000000Z',
          groups: [],
        }),
      ),
    );
    return renderWithProviders(
      <AppContextProvider>
        {waitForPermissions ? (
          <PermissionsKnown>
            <UserProfile />
          </PermissionsKnown>
        ) : (
          <UserProfile />
        )}
      </AppContextProvider>,
      { route: '/users/profile' },
    );
  }

  it('shows their own profile', async () => {
    renderProfile();

    expect(await screen.findByText('Zo')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeNull();
  });

  it('reads the record by its address and never asks for the list of users', async () => {
    renderProfile();
    await screen.findByText('Zo');

    expect(recorder.requests).toContain(`${API}/users/7/`);
    expect(
      recorder.requests.filter((path) => path.startsWith(`${API}/users/?`)),
    ).toEqual([]);
  });

  it('reads the record once for itself and never again while it is shown', async () => {
    // as in the application, the page does not wait for the permission read,
    // which reads the same record for the staff flag and the groups
    renderProfile({}, { waitForPermissions: false });
    await screen.findByText('Zo');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(
      recorder.requests.filter((path) => path === `${API}/users/7/`),
    ).toHaveLength(2);
  });

  // Editing a record is offered to whoever the server would let change it,
  // which is decided by the permission to change users. A user's own record is
  // readable by that user, but a change needs that permission too.
  it('offers no Edit to a user who may not change users', async () => {
    renderProfile();
    await screen.findByText('Zo');

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('offers no Edit to a user who may only view users', async () => {
    renderProfile({ own: [['auth.view_user']] });
    await screen.findByText('Zo');

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('offers Edit to a user who may change users', async () => {
    renderProfile({ own: [['auth.change_user']] });

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible();
  });

  it('offers Edit to an administrator', async () => {
    renderProfile({ isStaff: true });

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible();
  });
});

describe('the profile after a save', () => {
  it('returns to the saved values when Edit is followed by Cancel', async () => {
    recorder = servePermissions({ id: 7, username: 'zoe', isStaff: true });
    const patches: unknown[] = [];
    // the server keeps what was saved, as Pulp does
    let record: Record<string, unknown> = {
      pulp_href: `${API}/users/7/`,
      id: 7,
      username: 'zoe',
      first_name: 'Zo',
      last_name: '',
      email: '',
      is_staff: true,
      is_active: true,
      date_joined: '2000-01-01T00:00:00.000000Z',
      groups: [],
    };
    server.use(
      listOf(`${API}/groups/`, []).handler,
      http.get(`*${API}/users/`, () =>
        HttpResponse.json({ detail: 'no' }, { status: 403 }),
      ),
      http.get(`*${API}/users/7/`, () => HttpResponse.json(record)),
      http.patch(`*${API}/users/7/`, async ({ request }) => {
        const changes = (await request.json()) as Record<string, unknown>;
        patches.push(changes);
        record = { ...record, ...changes };
        return HttpResponse.json(record);
      }),
    );
    const { user } = renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <UserProfile />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/users/profile' },
    );

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const firstName = screen.getByLabelText(/First name/);
    await user.clear(firstName);
    await user.type(firstName, 'New');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved changes to user/);
    // only the field that was changed is sent
    expect(patches).toEqual([{ first_name: 'New' }]);

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.type(screen.getByLabelText(/First name/), 'x');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.getByText('New')).toBeInTheDocument());
    expect(screen.queryByText('Zo')).toBeNull();
    expect(screen.queryByText('Newx')).toBeNull();
  });
});

const RECORD = {
  pulp_href: `${API}/users/7/`,
  id: 7,
  username: 'zoe',
  first_name: 'Zo',
  last_name: '',
  email: '',
  is_active: true,
  date_joined: '2000-01-01T00:00:00.000000Z',
  groups: [],
};

describe('the profile page when the record cannot be read', () => {
  const failRead = (status: number, body: object = {}) =>
    server.use(
      http.get(`*${API}/users/7/`, () =>
        HttpResponse.json(body, { status, statusText: 'Failed' }),
      ),
    );

  function renderFailing(status: number, body?: object) {
    recorder = servePermissions({ id: 7, username: 'zoe', isStaff: false });
    failRead(status, body);
    return renderWithProviders(
      <AppContextProvider>
        <UserProfile />
      </AppContextProvider>,
      { route: '/users/profile' },
    );
  }

  it('offers Retry for a failed first read and never shows the not-found page', async () => {
    const { user } = renderFailing(500);

    expect(
      await screen.findByText('User could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/couldn't find the page/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();

    server.use(
      listOf(`${API}/groups/`, []).handler,
      http.get(`*${API}/users/7/`, () =>
        HttpResponse.json({ ...RECORD, is_staff: false }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Zo')).toBeInTheDocument();
  });

  it('shows the not-found page for a record that does not exist', async () => {
    renderFailing(404, { detail: 'Not found.' });

    expect(
      await screen.findByText(/couldn't find the page/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows the insufficient permissions page with the reason for a refused read', async () => {
    renderFailing(403, { detail: 'Not for you.' });

    expect(await screen.findByText('Not for you.')).toBeInTheDocument();
    expect(screen.queryByText(/couldn't find the page/)).toBeNull();
  });
});

describe('the profile page after signing in again', () => {
  beforeEach(() => serveSignIn());

  function renderAfterSession() {
    return renderWithProviders(
      <AppContextProvider>
        <SignInAgain />
        <Routes>
          <Route path='/users/profile' element={<UserProfile />} />
        </Routes>
      </AppContextProvider>,
      { route: '/users/profile' },
    );
  }

  const signInAgain = (user: ReturnType<typeof renderAfterSession>['user']) =>
    user.click(
      screen.getByRole('button', { name: 'Sign in again', hidden: true }),
    );

  it('adds one alert for a failed re-read and keeps what was typed', async () => {
    server.use(
      http.get(`*${API}/users/1/`, () =>
        HttpResponse.json({
          ...RECORD,
          pulp_href: `${API}/users/1/`,
          id: 1,
          is_staff: true,
        }),
      ),
      listOf(`${API}/groups/`, []).handler,
    );
    const { user } = renderAfterSession();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const lastName = await screen.findByLabelText(/Last name/);
    await user.type(lastName, 'Typed');
    await signedIn();
    server.use(
      http.get(`*${API}/users/1/`, () =>
        HttpResponse.json({}, { status: 500, statusText: 'Server Error' }),
      ),
    );

    await signInAgain(user);

    expect(
      await screen.findAllByText('User could not be displayed.'),
    ).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByText('User could not be displayed.')).toHaveLength(1);
    expect(screen.getByLabelText(/Last name/)).toHaveValue('Typed');
    expect(screen.queryByText(/couldn't find the page/)).toBeNull();
  });

  it('never replaces a newer record with the answer of an older read', async () => {
    let reads = 0;
    server.use(
      http.get(`*${API}/users/1/`, async () => {
        reads += 1;
        const mine = reads;
        // the first answer is slow, the second one fast
        await delay(mine === 1 ? 400 : 0);
        return HttpResponse.json({
          ...RECORD,
          pulp_href: `${API}/users/1/`,
          id: 1,
          first_name: mine === 1 ? 'Old' : 'Newer',
          is_staff: true,
        });
      }),
      listOf(`${API}/groups/`, []).handler,
    );
    const { user } = renderAfterSession();
    await signedIn();

    await signInAgain(user);

    expect(await screen.findByText('Newer')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(screen.getByText('Newer')).toBeInTheDocument();
    expect(screen.queryByText('Old')).toBeNull();
  });
});

describe('the profile page while the permissions cannot be read', () => {
  it('shows the failed state with Retry and offers no Edit, then the profile after Retry', async () => {
    recorder = servePermissions({
      id: 7,
      username: 'zoe',
      isStaff: false,
      own: [['auth.change_user']],
    });
    server.use(
      listOf(`${API}/groups/`, []).handler,
      http.get(`*${API}/users/7/`, () =>
        HttpResponse.json({ ...RECORD, is_staff: false }),
      ),
      // the permission read of the signed-in user fails once
      http.get(
        `*${API}/users/7/roles/`,
        () =>
          HttpResponse.json({}, { status: 500, statusText: 'Server Error' }),
        { once: true },
      ),
    );
    const { user } = renderWithProviders(
      <AppContextProvider>
        <UserProfile />
      </AppContextProvider>,
      { route: '/users/profile' },
    );

    expect(
      await screen.findByText('Your permissions could not be read'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible();
    expect(screen.getByText('Zo')).toBeInTheDocument();
    expect(screen.queryByText('Your permissions could not be read')).toBeNull();
  });
});

describe('the profile of a session that names no user address', () => {
  it('shows the not found page instead of a spinner that never ends', async () => {
    recorder = { requests: [], stop: () => undefined };
    server.use(
      http.get(`*${API}/login/`, () => HttpResponse.json({ username: 'zoe' })),
    );
    renderWithProviders(
      <AppContextProvider>
        <UserProfile />
      </AppContextProvider>,
      { route: '/users/profile' },
    );

    expect(
      await screen.findByText(/couldn't find the page/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
