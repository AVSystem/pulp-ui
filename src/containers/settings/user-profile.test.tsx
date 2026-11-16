import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import {
  type IPermissionSetup,
  PermissionsKnown,
  servePermissions,
} from 'src/test-utils/permissions';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import UserProfile from './user-profile';

// A user who holds no permission on the user list still reads their own
// record, because Pulp answers a read of one's own record by its address. The
// list of users is not asked for: Pulp refuses it to such a user.

const API = '/pulp/api/v3';

let recorder: { requests: string[]; stop: () => void };

afterEach(() => {
  recorder.stop();
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

  it('reads the record once although the page and the permissions both need it', async () => {
    // as in the application, the page does not wait for the permission read
    renderProfile({}, { waitForPermissions: false });
    await screen.findByText('Zo');
    // the permission read and the page start together; they share one request
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(
      recorder.requests.filter((path) => path === `${API}/users/7/`),
    ).toHaveLength(1);
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
