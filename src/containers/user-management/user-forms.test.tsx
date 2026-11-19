import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { listOf, user } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import UserCreate from './user-create';
import UserDetail from './user-detail';
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

// Renders the screens of the three routes inside the application context. The
// permission read is answered before the screen is shown unless the test asks
// to see the screen while it is read (or failing).
function renderScreens(
  route: string,
  { waitForPermissions = true, failPermissionsOnce = false } = {},
) {
  servePermissions({ isStaff: true });
  if (failPermissionsOnce) {
    // the first read of the permissions fails, the next one answers
    server.use(
      http.get(
        `*${API}/users/7/`,
        () =>
          HttpResponse.json({}, { status: 500, statusText: 'Server Error' }),
        { once: true },
      ),
    );
  }
  // the form searches groups for its group field
  server.use(listOf(`${API}/groups/`, []).handler);
  const screens = (
    <Routes>
      <Route path='/users/create' element={<UserCreate />} />
      <Route path='/users/detail/:user_id' element={<UserDetail />} />
      <Route path='/users/edit/:user_id' element={<UserEdit />} />
      <Route path='/users' element={<p>the user list page</p>} />
    </Routes>
  );

  return renderWithProviders(
    <AppContextProvider>
      {waitForPermissions ? (
        <PermissionsKnown>{screens}</PermissionsKnown>
      ) : (
        screens
      )}
    </AppContextProvider>,
    { route },
  );
}

const renderEdit = (route = '/users/edit/4') => renderScreens(route);

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

    await u.type(
      screen.getByLabelText(/^Password(?! confirmation)/),
      'N3w!passw0rd',
    );
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

describe('the user create page', () => {
  const posts: Record<string, unknown>[] = [];

  function serveCreate(answer?: () => Response) {
    posts.length = 0;
    server.use(
      http.post(`*${API}/users/`, async ({ request }) => {
        posts.push((await request.json()) as Record<string, unknown>);
        return answer ? answer() : HttpResponse.json(ANN, { status: 201 });
      }),
    );
  }

  async function fill(u: ReturnType<typeof renderScreens>['user']) {
    await u.type(await field(/^Username/), 'zz-new');
    await u.type(screen.getByLabelText(/First name/), 'New');
    await u.type(
      screen.getByLabelText(/^Password(?! confirmation)/),
      'N3w!passw0rd',
    );
    await u.type(
      screen.getByLabelText(/Password confirmation/),
      'N3w!passw0rd',
    );
  }

  it('sends one POST with the fields of the form and returns to the list', async () => {
    serveCreate();
    const { user: u } = renderScreens('/users/create');
    await fill(u);

    await u.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('the user list page')).toBeInTheDocument();
    expect(posts).toEqual([
      {
        username: 'zz-new',
        first_name: 'New',
        last_name: '',
        email: '',
        password: 'N3w!passw0rd',
      },
    ]);
  });

  it('shows the three-part refusal of a refused create and keeps the input', async () => {
    serveCreate(() =>
      HttpResponse.json({ detail: 'Only staff may do this.' }, { status: 403 }),
    );
    const { user: u } = renderScreens('/users/create');
    await fill(u);

    await u.click(screen.getByRole('button', { name: 'Save' }));

    const refusal = await screen.findByText(
      /You do not have permission to do this\. Only staff may do this\. Contact your organization administrator for more information\./,
    );
    expect(refusal).toHaveClass('pulp-break-anywhere');
    expect(screen.getByLabelText(/^Username/)).toHaveValue('zz-new');
    expect(posts).toHaveLength(1);
  });

  it('shows the message of a rejected field beside the field', async () => {
    serveCreate(() =>
      HttpResponse.json(
        { username: 'A user with that username already exists.' },
        { status: 400 },
      ),
    );
    const { user: u } = renderScreens('/users/create');
    await fill(u);

    await u.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('A user with that username already exists.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('the user list page')).toBeNull();
  });
});

describe('the user detail page', () => {
  function serveDetail() {
    let removed = false;
    const deletes: string[] = [];
    server.use(
      http.get(`*${USER_PATH}`, () =>
        removed
          ? HttpResponse.json({ detail: 'Not found.' }, { status: 404 })
          : HttpResponse.json(ANN),
      ),
      http.delete(`*${USER_PATH}`, ({ request }) => {
        deletes.push(new URL(request.url).pathname);
        removed = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return { deletes };
  }

  it('reads the user by its address and offers Edit and Delete', async () => {
    serveDetail();
    renderScreens('/users/detail/4');

    expect(await screen.findByText('zz-ann')).toBeInTheDocument();
    expect(screen.getByText('Ann')).toBeInTheDocument();
    expect(screen.getByText('ann@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      '/users/edit/4/',
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  it('opens the delete dialog for the user and returns to the list once it is deleted', async () => {
    const { deletes } = serveDetail();
    const { user: u } = renderScreens('/users/detail/4');
    await screen.findByText('zz-ann');

    await u.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('zz-ann')).toBeInTheDocument();
    await u.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('the user list page')).toBeInTheDocument();
    expect(deletes).toEqual([USER_PATH]);
  });

  it('shows the not-found page for a user that does not exist', async () => {
    server.use(
      http.get(`*${USER_PATH}`, () =>
        HttpResponse.json({ detail: 'Not found.' }, { status: 404 }),
      ),
    );
    renderScreens('/users/detail/4');

    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });

  it('offers Retry when the read fails for another reason, and never the not-found page', async () => {
    server.use(
      http.get(`*${USER_PATH}`, () =>
        HttpResponse.json({}, { status: 500, statusText: 'Server Error' }),
      ),
    );
    const { user: u } = renderScreens('/users/detail/4');

    expect(
      await screen.findByText('User could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).toBeNull();
    serveDetail();
    await u.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('zz-ann')).toBeInTheDocument();
  });

  it('reads nothing for an id that is not a number', async () => {
    renderScreens('/users/detail/abc');

    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
  });
});

describe('the user screens while the permissions cannot be read', () => {
  const failed = () => screen.findByText('Your permissions could not be read');

  it.each([
    {
      screen: 'detail',
      route: '/users/detail/4',
      offered: () => screen.queryByRole('button', { name: 'Delete' }),
      shown: async () => {
        expect(await screen.findByText('zz-ann')).toBeInTheDocument();
        expect(await screen.findByRole('link', { name: 'Edit' })).toBeVisible();
      },
    },
    {
      screen: 'edit page',
      route: '/users/edit/4',
      offered: () => screen.queryByLabelText(/First name/),
      shown: async () => {
        expect(await field(/First name/)).toHaveValue('Ann');
      },
    },
    {
      screen: 'create page',
      route: '/users/create',
      offered: () => screen.queryByLabelText(/^Username/),
      shown: async () => {
        expect(await field(/^Username/)).toHaveValue('');
      },
    },
  ])(
    'shows the failed state with Retry on the $screen, offers nothing, and shows the screen after Retry',
    async ({ route, offered, shown }) => {
      serveAnn();
      const { user: u } = renderScreens(route, {
        waitForPermissions: false,
        failPermissionsOnce: true,
      });

      expect(await failed()).toBeInTheDocument();
      expect(offered()).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();

      await u.click(screen.getByRole('button', { name: 'Retry' }));

      await shown();
      expect(
        screen.queryByText('Your permissions could not be read'),
      ).toBeNull();
    },
  );

  it('keeps a form the user changed when the permissions cannot be read after signing in again', async () => {
    serveSignIn();
    serveAnn();
    server.use(listOf(`${API}/groups/`, []).handler);
    const { user: u } = renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignInAgain />
          <Routes>
            <Route path='/users/edit/:user_id' element={<UserEdit />} />
          </Routes>
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/users/edit/4' },
    );
    const first = await field(/First name/);
    await signedIn();
    await u.clear(first);
    await u.type(first, 'Typed');
    // the permissions of the signed-in user are read again after signing in
    server.use(
      http.get(`*${API}/users/1/`, () =>
        HttpResponse.json({}, { status: 500, statusText: 'Server Error' }),
      ),
    );

    await u.click(
      screen.getByRole('button', { name: 'Sign in again', hidden: true }),
    );

    await waitFor(() =>
      expect(screen.getByLabelText(/First name/)).toHaveValue('Typed'),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByLabelText(/First name/)).toBe(first);
    expect(screen.queryByText('Your permissions could not be read')).toBeNull();
  });
});
