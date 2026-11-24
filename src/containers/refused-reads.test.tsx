import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import GroupDetail from './group-management/group-detail';
import GroupList from './group-management/group-list';
import RoleEdit from './role-management/role-edit';
import RoleList from './role-management/role-list';
import UserProfile from './settings/user-profile';
import SignatureKeysList from 'src/framework/signature-keys/signature-key-list';
import UserDetail from './user-management/user-detail';
import UserEdit from './user-management/user-edit';
import UserList from './user-management/user-list';

// The user and group screens show the insufficient permissions page when Pulp
// refuses the read that fills them. The page is presentation: Pulp refused the
// request.

const API = '/pulp/api/v3';

let recorder: { stop: () => void };

beforeEach(() => {
  recorder = servePermissions({ id: 1, isStaff: true });
});

afterEach(() => {
  recorder.stop();
});

const refuse = (path: string, body: object = { detail: 'Not for you.' }) =>
  server.use(
    http.get(`*${path}`, () =>
      HttpResponse.json(body, { status: 403, statusText: 'Forbidden' }),
    ),
  );

const withProvider = (ui: ReactNode) => (
  <AppContextProvider>
    <PermissionsKnown>{ui}</PermissionsKnown>
  </AppContextProvider>
);

const insufficient = () =>
  screen.findByRole('heading', { name: 'Insufficient permissions', level: 4 });

const sentence = () =>
  screen.getByText('You do not have permission to view this page.');

function expectNoRetryAndNoAlert(listError?: string) {
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  if (listError) {
    expect(screen.queryByText(listError)).toBeNull();
  }
  expect(screen.queryByText(/Error 403/)).toBeNull();
  expect(screen.queryByRole('progressbar')).toBeNull();
}

describe('the group list', () => {
  const render = (wrap = withProviderFn) =>
    renderWithProviders(wrap(<GroupList />), { route: '/groups' });

  it('shows the page with the server text for a refused read, below its own header', async () => {
    refuse(`${API}/groups/`);
    render();

    await insufficient();
    expect(sentence()).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Groups' })).toBeInTheDocument();
    expectNoRetryAndNoAlert('Groups list could not be displayed.');
  });
});

describe('the group detail', () => {
  const render = (wrap = withProviderFn) =>
    renderWithProviders(
      wrap(
        <Routes>
          <Route path='/groups/detail/:group' element={<GroupDetail />} />
        </Routes>,
      ),
      { route: '/groups/detail/7' },
    );

  it('shows the page with the server text for a refused read', async () => {
    refuse(`${API}/groups/7/`);
    render();

    await insufficient();
    expect(sentence()).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    // a screen without a header of its own gets one with the page title
    expect(
      screen.getByRole('heading', {
        name: 'Insufficient permissions',
        level: 1,
      }),
    ).toBeInTheDocument();
    expectNoRetryAndNoGroupAlert();
  });
});

describe('the user list', () => {
  const render = (wrap = withProviderFn) =>
    renderWithProviders(wrap(<UserList />), { route: '/users' });

  it('shows the page with the server text for a refused read, below its own header', async () => {
    refuse(`${API}/users/`);
    render();

    await insufficient();
    expect(sentence()).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expectNoRetryAndNoAlert('Users list could not be displayed.');
  });
});

describe('the user detail', () => {
  const render = (wrap = withProviderFn) =>
    renderWithProviders(
      wrap(
        <Routes>
          <Route path='/users/detail/:user_id' element={<UserDetail />} />
        </Routes>,
      ),
      { route: '/users/detail/4' },
    );

  it('shows the page with the server text for a refused read, not the not-found page', async () => {
    refuse(`${API}/users/4/`);
    render();

    await insufficient();
    expect(sentence()).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Insufficient permissions',
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("We couldn't find the page you're looking for!"),
    ).toBeNull();
    expectNoRetryAndNoAlert();
  });
});

describe('the user edit page', () => {
  const render = (wrap = withProviderFn) =>
    renderWithProviders(
      wrap(
        <Routes>
          <Route path='/users/edit/:user_id' element={<UserEdit />} />
        </Routes>,
      ),
      { route: '/users/edit/4' },
    );

  it('shows the page with the server text for a refused read, below its own header', async () => {
    refuse(`${API}/users/4/`);
    render();

    await insufficient();
    expect(sentence()).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Edit user' }),
    ).toBeInTheDocument();
    expectNoRetryAndNoAlert();
  });

  it('shows no server text when the refusal carried none', async () => {
    refuse(`${API}/users/4/`, {});
    render();

    await insufficient();
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
  });

  it('shows the not-found page, not the refusal, when the user does not exist', async () => {
    server.use(
      http.get(`*${API}/users/4/`, () =>
        HttpResponse.json({ detail: 'gone' }, { status: 404 }),
      ),
    );
    render();

    expect(
      await screen.findByText("We couldn't find the page you're looking for!"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeNull();
  });

  it('shows a retryable error state, not the refusal, for another failure, and reads again on Retry', async () => {
    let reads = 0;
    server.use(
      http.get(`*${API}/users/4/`, () => {
        reads += 1;
        return reads === 1
          ? HttpResponse.json({}, { status: 500, statusText: 'Server Error' })
          : HttpResponse.json({
              id: 4,
              username: 'zz-ann',
              first_name: 'Ann',
              last_name: '',
              email: '',
              groups: [],
              pulp_href: `${API}/users/4/`,
            });
      }),
      http.get(`*${API}/groups/`, () =>
        HttpResponse.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        }),
      ),
    );
    const { user: u } = render();

    expect(
      await screen.findByText('User could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Error 500 - Server Error/)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeNull();

    await u.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByLabelText(/First name/)).toHaveValue('Ann');
    expect(screen.queryByText('User could not be displayed.')).toBeNull();
    expect(reads).toBe(2);
  });
});

function withProviderFn(ui: ReactNode) {
  return withProvider(ui);
}

function expectNoRetryAndNoGroupAlert() {
  expectNoRetryAndNoAlert('Group could not be displayed.');
}

describe('the role edit page', () => {
  const ROLE = '0192e5a1-0000-7000-8000-0000000000aa';
  const render = () =>
    renderWithProviders(
      withProviderFn(
        <Routes>
          <Route path='/roles/edit/:role' element={<RoleEdit />} />
        </Routes>,
      ),
      { route: `/roles/edit/${ROLE}/` },
    );

  it('shows the page with the server text when the first read is refused', async () => {
    refuse(`${API}/roles/${ROLE}/`);
    render();

    await insufficient();
    expect(sentence()).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Insufficient permissions',
        level: 1,
      }),
    ).toBeInTheDocument();
    expectNoRetryAndNoAlert();
  });

  it('shows an alert with the failure title, and does not fail inside its own handler, when the first read fails for another reason', async () => {
    server.use(
      http.get(`*${API}/roles/${ROLE}/`, () =>
        HttpResponse.json({}, { status: 500, statusText: 'Server Error' }),
      ),
    );
    render();

    expect(
      await screen.findByText('Role could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Error 500 - Server Error/)).toBeInTheDocument();
  });
});

describe('the role list', () => {
  const render = () =>
    renderWithProviders(withProviderFn(<RoleList />), { route: '/roles' });

  it('shows the page with the server text for a refused read, below its own header', async () => {
    refuse(`${API}/roles/`);
    render();

    await insufficient();
    expect(sentence()).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Roles' })).toBeInTheDocument();
    expectNoRetryAndNoAlert('Roles list could not be displayed.');
  });

  it('shows an alert with the failure title for another failure', async () => {
    server.use(
      http.get(`*${API}/roles/`, () =>
        HttpResponse.json(
          { detail: 'broken' },
          { status: 500, statusText: 'Server Error' },
        ),
      ),
    );
    render();

    expect(
      await screen.findByText('Roles list could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Error 500 - Server Error/)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeNull();
  });
});

describe('the signing services list', () => {
  const render = () =>
    renderWithProviders(withProviderFn(<SignatureKeysList />), {
      route: '/signature-keys',
    });

  it('shows the page with the server text for a refused read, below its own header', async () => {
    refuse(`${API}/signing-services/`);
    render();

    await insufficient();
    expect(sentence()).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Signature keys', level: 1 }),
    ).toBeInTheDocument();
    expectNoRetryAndNoAlert('Signature keys could not be displayed.');
  });

  it('shows no server text when the refusal carried none', async () => {
    refuse(`${API}/signing-services/`, {});
    render();

    await insufficient();
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
  });

  it('shows an alert with the failure title for another failure', async () => {
    server.use(
      http.get(`*${API}/signing-services/`, () =>
        HttpResponse.json(
          { detail: 'broken' },
          { status: 500, statusText: 'Server Error' },
        ),
      ),
    );
    render();

    expect(
      await screen.findByText('Signature keys could not be displayed.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeNull();
  });
});

describe('the profile page', () => {
  // The profile does not wait for the permission read, which would fail with
  // the same refusal as the record itself.
  const render = () =>
    renderWithProviders(
      <AppContextProvider>
        <UserProfile />
      </AppContextProvider>,
      { route: '/users/profile' },
    );

  it('shows the page with the server text for a refused read, not the not-found page', async () => {
    refuse(`${API}/users/1/`);
    render();

    await insufficient();
    expect(sentence()).toBeInTheDocument();
    expect(screen.getByText('Not for you.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Insufficient permissions',
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("We couldn't find the page you're looking for!"),
    ).toBeNull();
    expectNoRetryAndNoAlert();
  });

  it('offers Retry for another failure, not the not-found page', async () => {
    server.use(
      http.get(`*${API}/users/1/`, () =>
        HttpResponse.json(
          { detail: 'broken' },
          { status: 500, statusText: 'Server Error' },
        ),
      ),
    );
    render();

    expect(
      await screen.findByText('User could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(
      screen.queryByText("We couldn't find the page you're looking for!"),
    ).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeNull();
  });
});
