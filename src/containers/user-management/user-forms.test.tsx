import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { listOf, user } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import UserEdit from './user-edit';

const API = '/pulp/api/v3';
const USER_PATH = `${API}/users/4/`;
const ANN = user({
  id: 4,
  username: 'zz-ann',
  first_name: 'Ann',
  last_name: 'Lee',
  email: 'ann@example.com',
});

const ADMIN_HINT =
  'Contact your organization administrator for more information.';

afterEach(() => {
  resetSessionEvents();
});

// Serves the user that is edited and records the body of every PATCH.
function serveAnn() {
  const patches: { path: string; body: Record<string, unknown> }[] = [];
  server.use(
    http.get(`*${USER_PATH}`, () => HttpResponse.json(ANN)),
    http.patch(`*${USER_PATH}`, async ({ request }) => {
      patches.push({
        path: new URL(request.url).pathname,
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json(ANN);
    }),
  );
  return patches;
}

function renderEdit(route = '/users/edit/4') {
  servePermissions({ isStaff: true });
  // the form searches groups for its group field
  server.use(listOf(`${API}/groups/`, []).handler);
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routes>
          <Route path='/users/edit/:user_id' element={<UserEdit />} />
          <Route path='/users' element={<p>the user list page</p>} />
        </Routes>
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const field = (label: RegExp) => screen.findByLabelText(label);

describe('the user edit page', () => {
  it('reads the user by its address and shows the form', async () => {
    serveAnn();
    renderEdit();

    expect(await field(/^Username/)).toHaveValue('zz-ann');
    expect(screen.getByLabelText(/First name/)).toHaveValue('Ann');
    expect(screen.getByLabelText(/Last name/)).toHaveValue('Lee');
    expect(screen.getByLabelText(/Email/)).toHaveValue('ann@example.com');
    expect(screen.getByLabelText(/^Password$/)).toHaveValue('');
  });

  it('sends one PATCH to the address with the changed fields and returns to the list', async () => {
    const patches = serveAnn();
    const { user: u } = renderEdit();
    const first = await field(/First name/);

    await u.clear(first);
    await u.type(first, 'Anna');
    await u.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('the user list page')).toBeInTheDocument();
    expect(patches).toEqual([
      { path: USER_PATH, body: { first_name: 'Anna' } },
    ]);
  });

  it('sends the password only when one was typed', async () => {
    const patches = serveAnn();
    const { user: u } = renderEdit();
    await field(/First name/);

    await u.type(screen.getByLabelText(/^Password$/), 'N3w!passw0rd');
    await u.type(
      screen.getByLabelText(/Password confirmation/),
      'N3w!passw0rd',
    );
    await u.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('the user list page');
    expect(patches).toEqual([
      { path: USER_PATH, body: { password: 'N3w!passw0rd' } },
    ]);
  });

  it('shows the three-part refusal of a refused save and keeps what was typed', async () => {
    serveAnn();
    server.use(
      http.patch(`*${USER_PATH}`, () =>
        HttpResponse.json(
          { detail: 'Only staff may do this.' },
          { status: 403 },
        ),
      ),
    );
    const { user: u } = renderEdit();
    const first = await field(/First name/);
    await u.clear(first);
    await u.type(first, 'Typed');

    await u.click(screen.getByRole('button', { name: 'Save' }));

    const refusal = await screen.findByText(
      new RegExp(
        `You do not have permission to do this\\. Only staff may do this\\. ${ADMIN_HINT.replace('.', '\\.')}`,
      ),
    );
    expect(refusal.tagName).toBe('P');
    expect(refusal).toHaveClass('pulp-break-anywhere');
    expect(screen.getByLabelText(/First name/)).toHaveValue('Typed');
    expect(screen.queryByText('the user list page')).toBeNull();
  });

  it('shows the message of a rejected field beside the field', async () => {
    serveAnn();
    server.use(
      http.patch(`*${USER_PATH}`, () =>
        HttpResponse.json(
          { username: 'A user with that username already exists.' },
          { status: 400 },
        ),
      ),
    );
    const { user: u } = renderEdit();
    const name = await field(/^Username/);
    await u.type(name, 'x');

    await u.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('A user with that username already exists.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Username/)).toHaveValue('zz-annx');
  });

  it('shows the insufficient permissions page when the read is refused', async () => {
    server.use(
      http.get(`*${USER_PATH}`, () =>
        HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
      ),
    );
    renderEdit();

    expect(await screen.findByText('Not for you.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/First name/)).toBeNull();
  });

  it('shows the not-found page for a user that does not exist', async () => {
    server.use(
      http.get(`*${USER_PATH}`, () =>
        HttpResponse.json({ detail: 'Not found.' }, { status: 404 }),
      ),
    );
    renderEdit();

    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('shows the not-found page and reads nothing for an id that is not a number', async () => {
    const reads: string[] = [];
    server.events.on('request:start', ({ request }) => {
      reads.push(new URL(request.url).pathname);
    });
    renderEdit('/users/edit/abc');

    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
    expect(reads.filter((path) => path.includes('abc'))).toEqual([]);
  });

  it('offers Retry when the first read fails and shows the form after it', async () => {
    server.use(
      http.get(`*${USER_PATH}`, () =>
        HttpResponse.json({}, { status: 500, statusText: 'Server Error' }),
      ),
    );
    const { user: u } = renderEdit();

    expect(
      await screen.findByText('User could not be displayed.'),
    ).toBeInTheDocument();
    serveAnn();
    await u.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() =>
      expect(screen.getByLabelText(/First name/)).toHaveValue('Ann'),
    );
  });
});
