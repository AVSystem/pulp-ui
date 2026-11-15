import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { group, listOf, user } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import GroupList from './group-management/group-list';

// What every administration screen must do once the session has ended: read
// again when the same user signs in again, keep what the user typed, and show
// no alert and no error state for a read or write that failed only because the
// session ended.

const API = '/pulp/api/v3';

afterEach(() => {
  resetSessionEvents();
});

const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));

// an open modal hides the rest of the page from the accessibility tree
const signInAgain = (u) =>
  u.click(screen.getByRole('button', { name: 'Sign in again', hidden: true }));

const refused = (method: 'get' | 'post' | 'put' | 'delete', path: string) =>
  http[method](`*${path}`, () =>
    HttpResponse.json({ detail: 'no' }, { status: 401 }),
  );

describe('the group list', () => {
  const GROUPS = `${API}/groups/`;

  const serve = (...names: string[]) =>
    server.use(
      listOf(
        GROUPS,
        names.map((name) => group({ name })),
      ).handler,
    );

  // the text box of the open create dialog
  const nameField = async () =>
    within(await screen.findByRole('dialog')).getByRole('textbox');

  const openDeleteDialog = async (u) => {
    await u.click(
      within(screen.getByText('zz-alpha').closest('tr')).getByRole('button', {
        name: /actions|kebab/i,
      }),
    );
    await u.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  };

  function renderGroups() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <SignInAgain />
        <GroupList />
      </AppContextProvider>,
      { route: '/groups' },
    );
  }

  it('reads the groups again and shows the fresh rows', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    serve('zz-alpha', 'zz-beta');

    await signInAgain(u);

    expect(await screen.findByText('zz-beta')).toBeInTheDocument();
  });

  it('keeps the name typed in the create dialog while it reads again', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    await u.click(screen.getByRole('button', { name: 'Create' }));
    await u.type(await nameField(), 'zz-typed');
    serve('zz-alpha', 'zz-beta');

    await signInAgain(u);

    await waitFor(() =>
      expect(screen.getByText('zz-beta', { selector: 'a' })).toBeTruthy(),
    );
    expect(await nameField()).toHaveValue('zz-typed');
  });

  it('keeps its rows, with no alert, when the read is refused with 401', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    server.use(refused('get', GROUPS));

    await signInAgain(u);
    await pause();

    expect(screen.getByText('zz-alpha')).toBeInTheDocument();
    expect(
      screen.queryByText('Groups list could not be displayed.'),
    ).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the spinner, with no alert, when the first read is refused, and lists after signing in', async () => {
    server.use(refused('get', GROUPS));
    const { user: u } = renderGroups();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(
      screen.queryByText('Groups list could not be displayed.'),
    ).toBeNull();
    serve('zz-alpha');

    await signInAgain(u);

    expect(await screen.findByText('zz-alpha')).toBeInTheDocument();
  });

  it('still shows its alert when the read fails for another reason', async () => {
    server.use(
      http.get(`*${GROUPS}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderGroups();

    expect(
      await screen.findByText('Groups list could not be displayed.'),
    ).toBeInTheDocument();
  });

  it('lists the users a delete would affect from a Pulp-shaped answer', async () => {
    serve('zz-alpha');
    server.use(
      listOf(`${API}/users/`, [
        user({ username: 'zz-ann' }),
        user({ username: 'zz-bob' }),
      ]).handler,
    );
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();

    await openDeleteDialog(u);

    expect(await screen.findByText('zz-ann')).toBeInTheDocument();
    expect(screen.getByText('zz-bob')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('adds no alert when the delete dialog user read is refused with 401', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    server.use(refused('get', `${API}/users/`));

    await openDeleteDialog(u);
    await pause();

    expect(screen.queryByText('Users list could not be displayed.')).toBeNull();
    expect(screen.getByText(/Checking for affected users/)).toBeInTheDocument();
  });

  it('adds no alert when the delete is refused with 401', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    server.use(
      listOf(`${API}/users/`, []).handler,
      http.delete(`*${API}/groups/:id/`, () =>
        HttpResponse.json({ detail: 'no' }, { status: 401 }),
      ),
    );

    await openDeleteDialog(u);
    await screen.findByText(/No users will be affected/);
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );
    await pause();

    expect(screen.queryByText('Error deleting group.')).toBeNull();
    expect(
      screen.getByRole('link', { name: 'zz-alpha', hidden: true }),
    ).toBeInTheDocument();
  });

  it('still says so when the delete fails for another reason', async () => {
    serve('zz-alpha');
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();
    server.use(
      listOf(`${API}/users/`, []).handler,
      http.delete(`*${API}/groups/:id/`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );

    await openDeleteDialog(u);
    await screen.findByText(/No users will be affected/);
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    );

    expect(await screen.findByText('Error deleting group.')).toBeVisible();
  });

  it('sends no write', async () => {
    serve('zz-alpha');
    const recorded = recordWrites();
    const { user: u } = renderGroups();
    await screen.findByText('zz-alpha');
    await signedIn();

    await signInAgain(u);
    await pause();

    expect(recorded.writes).toEqual([`POST ${API}/login/`]);
    recorded.stop();
  });
});
