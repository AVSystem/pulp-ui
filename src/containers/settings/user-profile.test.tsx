import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { servePermissions } from 'src/test-utils/permissions';
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
  function renderProfile() {
    recorder = servePermissions({ id: 7, username: 'zoe', isStaff: false });
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
          is_staff: false,
          is_active: true,
          date_joined: '2000-01-01T00:00:00.000000Z',
          groups: [],
        }),
      ),
    );
    return renderWithProviders(
      <AppContextProvider>
        <UserProfile />
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
});
