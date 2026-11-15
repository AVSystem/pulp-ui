import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import {
  AppContext,
  AppContextProvider,
  type IAppContextType,
} from 'src/app-context';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import GroupDetail from './group-management/group-detail';
import GroupList from './group-management/group-list';
import UserDetail from './user-management/user-detail';
import UserEdit from './user-management/user-edit';
import UserList from './user-management/user-list';

// The user and group screens show the insufficient permissions page when Pulp
// refuses the read that fills them, and when the screen's own check says the
// user may not view it. The page is presentation: Pulp refused the request.

const API = '/pulp/api/v3';

const refuse = (path: string, body: object = { detail: 'Not for you.' }) =>
  server.use(
    http.get(`*${path}`, () =>
      HttpResponse.json(body, { status: 403, statusText: 'Forbidden' }),
    ),
  );

const withProvider = (ui: ReactNode) => (
  <AppContextProvider>{ui}</AppContextProvider>
);

// a context in which the screen's own view check says no
const NoViewPermission = ({ children }: { children: ReactNode }) => {
  const value: IAppContextType = {
    alerts: [],
    hasPermission: () => false,
    queueAlert: () => undefined,
    setAlerts: () => undefined,
    user: null,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

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

  it('shows the page without a server text when the screen check refuses', async () => {
    render(withNoPermission);

    await insufficient();
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Groups' })).toBeInTheDocument();
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

  it('shows the page without a server text when the screen check refuses', async () => {
    render(withNoPermission);

    await insufficient();
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
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

  it('shows the page without a server text when the screen check refuses', async () => {
    render(withNoPermission);

    await insufficient();
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
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

  it('shows the page without a server text when the screen check refuses', async () => {
    render(withNoPermission);

    await insufficient();
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
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
});

function withProviderFn(ui: ReactNode) {
  return withProvider(ui);
}

function withNoPermission(ui: ReactNode) {
  return <NoViewPermission>{ui}</NoViewPermission>;
}

function expectNoRetryAndNoGroupAlert() {
  expectNoRetryAndNoAlert('Group could not be displayed.');
}
