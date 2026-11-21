import { msg } from '@lingui/core/macro';
import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Action } from '../actions/action';
import { PulpAPI } from '../api/pulp';
import { AppContextProvider } from '../app-context';
import AnsibleRemoteEdit from '../containers/ansible-remote/edit';
import AnsibleRepositoryEdit from '../containers/ansible-repository/edit';
import PythonRemoteEdit from '../containers/python-remote/edit';
import PythonRepositoryEdit from '../containers/python-repository/edit';
import RPMRemoteEdit from '../containers/rpm-remote/edit';
import RPMRepositoryEdit from '../containers/rpm-repository/edit';
import { Paths } from '../paths';
import { resetSessionEvents, setSignedIn } from '../session/session-events';
import {
  serveMyPermissions,
  servePermissions,
} from '../test-utils/permissions';
import { page } from '../test-utils/pulp';
import { renderWithProviders } from '../test-utils/render';
import { server } from '../test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from '../test-utils/sign-in-again';
import {
  ACTION_PERMISSIONS,
  type PermissionPlugin,
} from '../utilities/action-permissions';
import { Page } from './page';

const withDeleteAction = (condition?: () => boolean) =>
  Page<IThing>({
    breadcrumbs: ({ name }) => [{ name: 'Things' }, { name }],
    condition,
    displayName: 'GuardedThingEdit',
    errorTitle: msg`Thing could not be displayed.`,
    headerActions: [
      Action({ title: msg`Delete thing`, onClick: () => undefined }),
    ],
    listUrl: '/things',
    query: ({ name }) =>
      things
        .list('things/', { name, page_size: 1 })
        .then(({ data }) => data.results[0]),
    title: ({ name }) => name,
    transformParams: ({ name }) => ({ name }),
    render: () => <form aria-label='Thing form' />,
  });

function renderGuarded(Screen: ReturnType<typeof withDeleteAction>) {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route path='/things/edit/:name' element={<Screen />} />
      </Routes>
    </AppContextProvider>,
    { route: '/things/edit/alpha' },
  );
}

const THINGS = '/pulp/api/v3/things/';

interface IThing {
  name: string;
}

const things = new PulpAPI();

let actionContext;

// The way the edit containers are built: a name of "_" in the route means a
// new object, and the form is shown for both.
const ThingEdit = Page<IThing>({
  breadcrumbs: ({ name }) => [{ name: 'Things' }, { name: name ?? 'Add' }],
  displayName: 'ThingEdit',
  errorTitle: msg`Thing could not be displayed.`,
  listUrl: '/things',
  query: ({ name }) =>
    things
      .list('things/', { name, page_size: 1 })
      .then(({ data }) => data.results[0]),
  title: ({ name }) => name || 'Add new thing',
  transformParams: ({ name }) => ({ name: name !== '_' ? name : null }),
  render: (item, context) => {
    actionContext = context;
    return (
      <form aria-label='Thing form'>
        <p>{item ? `Editing ${item.name}` : 'Creating a new thing'}</p>
        <button type='submit'>Save</button>
      </form>
    );
  },
});

function renderEdit(route: string) {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route path='/things/edit/:name' element={<ThingEdit />} />
      </Routes>
    </AppContextProvider>,
    { route },
  );
}

const answer = (...names: string[]) =>
  http.get(`*${THINGS}`, () =>
    HttpResponse.json(page(names.map((name) => ({ name })))),
  );

const failing = (status: number, statusText: string) =>
  http.get(`*${THINGS}`, () =>
    HttpResponse.json({ detail: 'no' }, { status, statusText }),
  );

const form = () => screen.queryByRole('form', { name: 'Thing form' });

afterEach(() => {
  actionContext = undefined;
});

describe('an edit page whose load fails', () => {
  it('shows the error state with Retry and not the form, for a network error', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    renderEdit('/things/edit/alpha');

    expect(
      await screen.findByRole('heading', {
        name: 'Thing could not be displayed.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(form()).not.toBeInTheDocument();
    expect(screen.queryByText('Creating a new thing')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('keeps the object title of the route above the error state', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    renderEdit('/things/edit/alpha');

    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
  });

  it('shows the status of a failed answer and no form', async () => {
    server.use(failing(503, 'Service Unavailable'));
    renderEdit('/things/edit/alpha');

    expect(
      await screen.findByText('Error 503 - Service Unavailable'),
    ).toBeInTheDocument();
    expect(form()).not.toBeInTheDocument();
  });

  it('shows the status of the 401 a visitor gets and no form', async () => {
    server.use(failing(401, 'Unauthorized'));
    renderEdit('/things/edit/alpha');

    expect(
      await screen.findByText('Error 401 - Unauthorized'),
    ).toBeInTheDocument();
    expect(form()).not.toBeInTheDocument();
  });

  it('keeps its loading state without an error or alert for the 401 of a signed-in user', async () => {
    server.use(failing(401, 'Unauthorized'));
    renderEdit('/things/edit/alpha');
    setSignedIn(true);

    await waitFor(() => expect(screen.getByRole('progressbar')).toBeVisible());
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Thing could not be displayed.' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Thing could not be displayed.')).toBeNull();
    expect(form()).not.toBeInTheDocument();
  });

  it('shows the failure once, with no alert besides the error state', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    renderEdit('/things/edit/alpha');

    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getAllByText('Thing could not be displayed.')).toHaveLength(
      1,
    );
  });

  it('shows the form for the object once Retry finds it', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    const { user } = renderEdit('/things/edit/alpha');
    await screen.findByRole('button', { name: 'Retry' });

    server.use(answer('alpha'));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Editing alpha')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('leaves no unhandled promise rejection behind', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
      const { user } = renderEdit('/things/edit/alpha');
      await screen.findByRole('button', { name: 'Retry' });
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await screen.findByRole('button', { name: 'Retry' });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    } finally {
      process.off('unhandledRejection', unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
  });

  it('leaves no unhandled rejection when a reload from an action fails', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      let calls = 0;
      server.use(
        http.get(`*${THINGS}`, () => {
          calls += 1;
          return calls === 1
            ? HttpResponse.json(page([{ name: 'alpha' }]))
            : HttpResponse.error();
        }),
      );
      renderEdit('/things/edit/alpha');
      await screen.findByText('Editing alpha');

      act(() => {
        actionContext.query();
      });
      await screen.findByRole('button', { name: 'Retry' });
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    } finally {
      process.off('unhandledRejection', unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('an edit page for a new object', () => {
  it('shows the form without loading anything', async () => {
    renderEdit('/things/edit/_');

    expect(await screen.findByText('Creating a new thing')).toBeInTheDocument();
    expect(form()).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });
});

describe('an edit page whose load succeeds', () => {
  it('shows the form of the loaded object', async () => {
    server.use(answer('alpha'));
    renderEdit('/things/edit/alpha');

    expect(await screen.findByText('Editing alpha')).toBeInTheDocument();
  });

  it('keeps the object of the newest request when an older failure arrives last', async () => {
    let calls = 0;
    server.use(
      http.get(`*${THINGS}`, async () => {
        calls += 1;
        if (calls === 2) {
          await delay(150);
          return HttpResponse.json({ detail: 'late' }, { status: 503 });
        }
        return HttpResponse.json(page([{ name: 'alpha' }]));
      }),
    );
    renderEdit('/things/edit/alpha');
    await screen.findByText('Editing alpha');

    act(() => {
      actionContext.query();
      actionContext.query();
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));

    await waitFor(() => expect(calls).toBe(3));
    expect(screen.getByText('Editing alpha')).toBeInTheDocument();
    expect(screen.queryByText(/Error 503/)).not.toBeInTheDocument();
  });
});

function renderAfterSignIn(route = '/things/edit/alpha') {
  serveSignIn();
  return renderWithProviders(
    <>
      <SignInAgain />
      <AppContextProvider>
        <Routes>
          <Route path='/things/edit/:name' element={<ThingEdit />} />
        </Routes>
      </AppContextProvider>
    </>,
    { route, signedIn: true },
  );
}

// Answers with the given names, one answer per read, the last one repeating.
const answers = (...replies: (string | Response)[]) => {
  let calls = 0;
  const handler = http.get(`*${THINGS}`, async () => {
    const reply = replies[Math.min(calls, replies.length - 1)];
    calls += 1;
    await delay(40);
    return typeof reply === 'string'
      ? HttpResponse.json(page([{ name: reply }]))
      : reply.clone();
  });
  return { handler, calls: () => calls };
};

describe('a page after the same user signs in again', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  it('reads the object again without a loading state and shows the fresh object', async () => {
    const { handler, calls } = answers('alpha', 'alpha-2');
    server.use(handler);
    const { user } = renderAfterSignIn();
    await screen.findByText('Editing alpha');
    await signedIn();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(calls()).toBe(2));

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Editing alpha')).toBeInTheDocument();
    expect(await screen.findByText('Editing alpha-2')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('sends no write besides the sign-in', async () => {
    const { handler } = answers('alpha');
    server.use(handler);
    const recorded = recordWrites();
    const { user } = renderAfterSignIn();
    await screen.findByText('Editing alpha');
    await signedIn();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await screen.findByText('Editing alpha');
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

    expect(recorded.writes).toEqual(['POST /pulp/api/v3/login/']);
    recorded.stop();
  });

  it('keeps the page as it was and adds one alert with the error title when the read fails', async () => {
    const { handler, calls } = answers(
      'alpha',
      HttpResponse.json({ detail: 'no' }, { status: 500 }),
    );
    server.use(handler);
    const { user } = renderAfterSignIn();
    await screen.findByText('Editing alpha');
    await signedIn();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(calls()).toBe(2));

    expect(await screen.findByText(/Error 500/)).toBeInTheDocument();
    expect(screen.getAllByText('Thing could not be displayed.')).toHaveLength(
      1,
    );
    expect(screen.getByText('Editing alpha')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('keeps the page as it was and adds no alert when the read is refused with 401', async () => {
    const { handler, calls } = answers(
      'alpha',
      HttpResponse.json({ detail: 'no' }, { status: 401 }),
    );
    server.use(handler);
    const { user } = renderAfterSignIn();
    await screen.findByText('Editing alpha');
    await signedIn();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(calls()).toBe(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

    expect(screen.getByText('Editing alpha')).toBeInTheDocument();
    expect(screen.queryByText('Thing could not be displayed.')).toBeNull();
    expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
  });

  it('runs the first read again when it was refused, and shows the object', async () => {
    const { handler, calls } = answers(
      HttpResponse.json({ detail: 'no' }, { status: 401 }),
      'alpha',
    );
    server.use(handler);
    const { user } = renderAfterSignIn();
    await waitFor(() => expect(calls()).toBe(1));
    await signedIn();
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(screen.getByRole('progressbar')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText('Editing alpha')).toBeInTheDocument();
    expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
  });

  it('reads nothing for a new object', async () => {
    const { handler, calls } = answers('alpha');
    server.use(handler);
    const { user } = renderAfterSignIn('/things/edit/_');
    await screen.findByText('Creating a new thing');
    await signedIn();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

    expect(calls()).toBe(0);
    expect(screen.getByText('Creating a new thing')).toBeInTheDocument();
  });
});

describe('an edit page whose load is refused', () => {
  it('shows the insufficient permissions page with the server text instead of the form or an error state', async () => {
    server.use(failing(403, 'Forbidden'));
    renderEdit('/things/edit/alpha');

    expect(
      await screen.findByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You do not have permission to view this page.'),
    ).toBeInTheDocument();
    expect(screen.getByText('no')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Contact your organization administrator for more information.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Thing could not be displayed.' }),
    ).toBeNull();
    expect(form()).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    // the screen keeps its own title above the page
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
  });

  it('omits the detail paragraph for a 403 without a detail', async () => {
    server.use(
      http.get(`*${THINGS}`, () =>
        HttpResponse.json({}, { status: 403, statusText: 'Forbidden' }),
      ),
    );
    renderEdit('/things/edit/alpha');

    await screen.findByRole('heading', { name: 'Insufficient permissions' });
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
  });

  it('renders no header action for a refused read, and renders it for a shown object', async () => {
    const Screen = withDeleteAction();

    server.use(failing(403, 'Forbidden'));
    const refused = renderGuarded(Screen);
    await screen.findByRole('heading', { name: 'Insufficient permissions' });
    expect(
      screen.queryByRole('button', { name: 'Delete thing' }),
    ).not.toBeInTheDocument();
    refused.unmount();

    server.use(answer('alpha'));
    renderGuarded(Screen);
    expect(
      await screen.findByRole('button', { name: 'Delete thing' }),
    ).toBeInTheDocument();
  });

  it('shows the same page without a detail when the screen condition is false for the loaded object', async () => {
    server.use(answer('alpha'));
    renderGuarded(withDeleteAction(() => false));

    await screen.findByRole('heading', { name: 'Insufficient permissions' });
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: 'Delete thing' }),
    ).not.toBeInTheDocument();
  });
});

describe('a page whose header action needs a permission', () => {
  const HREF = '/pulp/api/v3/things/1/';
  const CHANGE = 'file.change_filerepository';

  const Screen = (objectLevel = true) =>
    Page<IThing>({
      breadcrumbs: ({ name }) => [{ name: 'Things' }, { name }],
      displayName: 'PermittedThingEdit',
      errorTitle: msg`Thing could not be displayed.`,
      headerActions: [
        Action({
          title: msg`Change thing`,
          permission: CHANGE,
          objectLevel,
          onClick: () => undefined,
        }),
      ],
      listUrl: '/things',
      query: ({ name }) =>
        things
          .list('things/', { name, page_size: 1 })
          .then(({ data }) => data.results[0]),
      title: ({ name }) => name,
      transformParams: ({ name }) => ({ name }),
      render: () => <form aria-label='Thing form' />,
    });

  function renderScreen(objectLevel = true) {
    const Thing = Screen(objectLevel);
    server.use(
      http.get(`*${THINGS}`, () =>
        HttpResponse.json(page([{ name: 'alpha', pulp_href: HREF }])),
      ),
    );
    return renderWithProviders(
      <AppContextProvider>
        <Routes>
          <Route path='/things/edit/:name' element={<Thing />} />
        </Routes>
      </AppContextProvider>,
      { route: '/things/edit/alpha' },
    );
  }

  const change = () => screen.queryByRole('button', { name: 'Change thing' });
  const settled = () => act(() => new Promise((r) => setTimeout(r, 120)));

  afterEach(() => {
    server.events.removeAllListeners();
  });

  it('shows the action to a global holder and reads no object permissions', async () => {
    servePermissions({ own: [[CHANGE]] });
    const { requests } = serveMyPermissions({});
    renderScreen();

    expect(
      await screen.findByRole('button', { name: 'Change thing' }),
    ).toBeInTheDocument();
    await settled();
    expect(requests).toEqual([]);
  });

  it('shows the action to a staff user and reads no object permissions', async () => {
    servePermissions({ isStaff: true });
    const { requests } = serveMyPermissions({});
    renderScreen();

    expect(
      await screen.findByRole('button', { name: 'Change thing' }),
    ).toBeInTheDocument();
    await settled();
    expect(requests).toEqual([]);
  });

  it('reads the object permissions once and shows the action when they list it', async () => {
    servePermissions({ own: [['file.view_filerepository']] });
    const { requests } = serveMyPermissions({ [HREF]: [CHANGE] });
    renderScreen();

    expect(
      await screen.findByRole('button', { name: 'Change thing' }),
    ).toBeInTheDocument();
    await settled();
    expect(requests).toEqual([`${HREF}my_permissions/`]);
  });

  it('keeps the action absent for an object whose permissions do not list it', async () => {
    servePermissions({ own: [['file.view_filerepository']] });
    const { requests } = serveMyPermissions({
      [HREF]: ['file.view_filerepository'],
    });
    renderScreen();

    await screen.findByRole('form', { name: 'Thing form' });
    await waitFor(() => expect(requests).toHaveLength(1));
    await settled();
    expect(change()).not.toBeInTheDocument();
  });

  it('keeps the action absent while the object permissions are being read', async () => {
    servePermissions({ own: [['file.view_filerepository']] });
    const { requests } = serveMyPermissions({
      [HREF]: { permissions: [CHANGE], delayMs: 250 },
    });
    renderScreen();

    await screen.findByRole('form', { name: 'Thing form' });
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(change()).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Change thing' }),
    ).toBeInTheDocument();
  });

  it.each([403, 500])(
    'treats a my_permissions read that answers %i as none, silently',
    async (status) => {
      servePermissions({ own: [['file.view_filerepository']] });
      const { requests } = serveMyPermissions({ [HREF]: { status } });
      renderScreen();

      await screen.findByRole('form', { name: 'Thing form' });
      await waitFor(() => expect(requests).toHaveLength(1));
      await settled();
      expect(change()).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    },
  );

  it('reads no object permissions for an action that is not object level', async () => {
    servePermissions({ own: [['file.view_filerepository']] });
    const { requests } = serveMyPermissions({ [HREF]: [CHANGE] });
    renderScreen(false);

    await screen.findByRole('form', { name: 'Thing form' });
    await settled();
    expect(requests).toEqual([]);
    expect(change()).not.toBeInTheDocument();
  });

  it('asks for nothing while nobody is signed in', async () => {
    const { requests } = serveMyPermissions({ [HREF]: [CHANGE] });
    renderScreen();

    await screen.findByRole('form', { name: 'Thing form' });
    await settled();
    expect(requests).toEqual([]);
    expect(change()).not.toBeInTheDocument();
  });
});

describe('a page whose header actions are all hidden', () => {
  const HREF = '/pulp/api/v3/things/1/';

  const Hidden = Page<IThing>({
    breadcrumbs: ({ name }) => [{ name: 'Things' }, { name }],
    displayName: 'HiddenActionsThingEdit',
    errorTitle: msg`Thing could not be displayed.`,
    headerActions: [
      Action({
        title: msg`Change thing`,
        permission: 'file.change_filerepository',
        objectLevel: false,
        onClick: () => undefined,
      }),
    ],
    listUrl: '/things',
    query: ({ name }) =>
      things
        .list('things/', { name, page_size: 1 })
        .then(({ data }) => data.results[0]),
    title: ({ name }) => name,
    transformParams: ({ name }) => ({ name }),
    render: () => <form aria-label='Thing form' />,
  });

  function renderHidden() {
    server.use(
      http.get(`*${THINGS}`, () =>
        HttpResponse.json(page([{ name: 'alpha', pulp_href: HREF }])),
      ),
    );
    return renderWithProviders(
      <AppContextProvider>
        <Routes>
          <Route path='/things/edit/:name' element={<Hidden />} />
        </Routes>
      </AppContextProvider>,
      { route: '/things/edit/alpha' },
    );
  }

  afterEach(() => {
    server.events.removeAllListeners();
  });

  it('renders no action container, and renders it once an action is allowed', async () => {
    servePermissions({ own: [['file.view_filerepository']] });
    const hidden = renderHidden();

    await screen.findByRole('form', { name: 'Thing form' });
    await act(() => new Promise((r) => setTimeout(r, 120)));
    expect(hidden.container.querySelector('.pulp-toolbar')).toBeNull();
    hidden.unmount();
    server.events.removeAllListeners();

    servePermissions({ own: [['file.change_filerepository']] });
    const shown = renderHidden();
    await screen.findByRole('button', { name: 'Change thing' });
    expect(shown.container.querySelector('.pulp-toolbar')).not.toBeNull();
  });
});

describe('a page whose form needs a permission', () => {
  const HREF = '/pulp/api/v3/things/1/';
  const CHANGE = 'file.change_filerepository';
  const ADD = 'file.add_filerepository';
  const VIEW = 'file.view_filerepository';

  let saves = 0;

  const Guarded = (objectLevel = true) =>
    Page<IThing>({
      breadcrumbs: ({ name }) => [{ name: 'Things' }, { name: name ?? 'Add' }],
      displayName: 'FormPermissionThingEdit',
      errorTitle: msg`Thing could not be displayed.`,
      formPermission: (item) =>
        item
          ? { permission: CHANGE, objectLevel }
          : { permission: ADD, objectLevel: false },
      headerActions: [
        Action({ title: msg`Delete thing`, onClick: () => undefined }),
      ],
      listUrl: '/things',
      query: ({ name }) =>
        things
          .list('things/', { name, page_size: 1 })
          .then(({ data }) => data.results[0]),
      title: ({ name }) => name || 'Add new thing',
      transformParams: ({ name }) => ({ name: name !== '_' ? name : null }),
      render: (item) => (
        <form
          aria-label='Thing form'
          onSubmit={(event) => {
            event.preventDefault();
            saves += 1;
          }}
        >
          <p>{item ? `Editing ${item.name}` : 'Creating a new thing'}</p>
          <button type='submit'>Save</button>
        </form>
      ),
    });

  function renderGuardedEdit(
    route = '/things/edit/alpha',
    objectLevel = true,
    served: { name: string; pulp_href: string }[] = [
      { name: 'alpha', pulp_href: HREF },
    ],
  ) {
    const Thing = Guarded(objectLevel);
    server.use(http.get(`*${THINGS}`, () => HttpResponse.json(page(served))));
    return renderWithProviders(
      <AppContextProvider>
        <Routes>
          <Route path='/things/edit/:name' element={<Thing />} />
        </Routes>
      </AppContextProvider>,
      { route },
    );
  }

  const saveButton = () => screen.queryByRole('button', { name: 'Save' });
  const refusal = () =>
    screen.queryByRole('heading', { name: 'Insufficient permissions' });
  const settled = () => act(() => new Promise((r) => setTimeout(r, 120)));

  afterEach(() => {
    server.events.removeAllListeners();
    saves = 0;
  });

  it('shows the insufficient permissions page below the header, with no form, Save button or header action, to an account that lacks the permission', async () => {
    servePermissions({ own: [[VIEW]] });
    const { requests } = serveMyPermissions({ [HREF]: [VIEW] });
    renderGuardedEdit();

    expect(
      await screen.findByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeInTheDocument();
    expect(requests).toEqual([`${HREF}my_permissions/`]);
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
    expect(saveButton()).not.toBeInTheDocument();
    expect(form()).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete thing' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
  });

  it('shows the form to an account that holds the permission globally, and reads no object permissions', async () => {
    servePermissions({ own: [[CHANGE]] });
    const { requests } = serveMyPermissions({});
    renderGuardedEdit();

    expect(await screen.findByText('Editing alpha')).toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
    await settled();
    expect(requests).toEqual([]);
    expect(refusal()).not.toBeInTheDocument();
  });

  it('shows the form to staff, and reads no object permissions', async () => {
    servePermissions({ isStaff: true });
    const { requests } = serveMyPermissions({});
    renderGuardedEdit();

    expect(await screen.findByText('Editing alpha')).toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
    await settled();
    expect(requests).toEqual([]);
  });

  it('shows the form when the permissions listed for the object hold the permission', async () => {
    servePermissions({ own: [[VIEW]] });
    const { requests } = serveMyPermissions({ [HREF]: [VIEW, CHANGE] });
    renderGuardedEdit();

    expect(await screen.findByText('Editing alpha')).toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
    await settled();
    expect(requests).toEqual([`${HREF}my_permissions/`]);
  });

  it('shows the loading state, never the form, while the object permissions are being read', async () => {
    servePermissions({ own: [[VIEW]] });
    const { requests } = serveMyPermissions({
      [HREF]: { permissions: [CHANGE], delayMs: 250 },
    });
    renderGuardedEdit();

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(form()).not.toBeInTheDocument();
    expect(refusal()).not.toBeInTheDocument();
    expect(await screen.findByText('Editing alpha')).toBeInTheDocument();
  });

  it.each([403, 500])(
    'shows the insufficient permissions page when the object permission read answers %i',
    async (status) => {
      servePermissions({ own: [[VIEW]] });
      serveMyPermissions({ [HREF]: { status } });
      renderGuardedEdit();

      expect(
        await screen.findByRole('heading', {
          name: 'Insufficient permissions',
        }),
      ).toBeInTheDocument();
      expect(saveButton()).not.toBeInTheDocument();
    },
  );

  it('shows the loading state, never the form, while the permissions of the account are unknown', async () => {
    const { requests } = serveMyPermissions({ [HREF]: [CHANGE] });
    renderGuardedEdit();

    await screen.findByRole('progressbar');
    await settled();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(form()).not.toBeInTheDocument();
    expect(refusal()).not.toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('reads no object permissions when the permission is not object level, and refuses', async () => {
    servePermissions({ own: [[VIEW]] });
    const { requests } = serveMyPermissions({ [HREF]: [CHANGE] });
    renderGuardedEdit('/things/edit/alpha', false);

    expect(
      await screen.findByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeInTheDocument();
    await settled();
    expect(requests).toEqual([]);
    expect(saveButton()).not.toBeInTheDocument();
  });

  it('shows the add form only to an account that holds the add permission globally', async () => {
    servePermissions({ own: [[CHANGE]] });
    const { requests } = serveMyPermissions({});
    const without = renderGuardedEdit('/things/edit/_');

    expect(
      await screen.findByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeInTheDocument();
    expect(saveButton()).not.toBeInTheDocument();
    without.unmount();
    server.events.removeAllListeners();

    servePermissions({ own: [[ADD]] });
    renderGuardedEdit('/things/edit/_');

    expect(await screen.findByText('Creating a new thing')).toBeInTheDocument();
    expect(saveButton()).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('shows the loading state, never the add form, while the permissions of the account are unknown', async () => {
    renderGuardedEdit('/things/edit/_');

    await screen.findByRole('progressbar');
    await settled();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(form()).not.toBeInTheDocument();
    expect(refusal()).not.toBeInTheDocument();
  });

  it('sends nothing for a refused page', async () => {
    servePermissions({ own: [[VIEW]] });
    serveMyPermissions({ [HREF]: [VIEW] });
    const recorded = recordWrites();
    renderGuardedEdit();

    await screen.findByRole('heading', { name: 'Insufficient permissions' });
    await settled();
    expect(recorded.writes).toEqual([]);
    expect(saves).toBe(0);
    recorded.stop();
  });

  describe('opened by the address of an object that is not listed', () => {
    const notFound = () =>
      screen.findByRole('heading', { name: '404 - Page not found' });

    it('shows the not-found page, never the add form, to an account that holds the add permission', async () => {
      servePermissions({ own: [[ADD]] });
      const { requests } = serveMyPermissions({});
      const recorded = recordWrites();
      renderGuardedEdit('/things/edit/missing', true, []);

      expect(await notFound()).toBeInTheDocument();
      await settled();
      expect(form()).not.toBeInTheDocument();
      expect(saveButton()).not.toBeInTheDocument();
      expect(
        screen.queryByText('Creating a new thing'),
      ).not.toBeInTheDocument();
      expect(refusal()).not.toBeInTheDocument();
      expect(requests).toEqual([]);
      expect(recorded.writes).toEqual([]);
      expect(saves).toBe(0);
      recorded.stop();
    });

    it('shows the not-found page and no header action to an account that holds the add and change permissions', async () => {
      servePermissions({ own: [[ADD, CHANGE]] });
      renderGuardedEdit('/things/edit/missing', true, []);

      expect(await notFound()).toBeInTheDocument();
      expect(saveButton()).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Delete thing' }),
      ).not.toBeInTheDocument();
    });

    it('shows the not-found page, not a refusal, to an account that holds no permission for the page', async () => {
      servePermissions({ own: [[VIEW]] });
      renderGuardedEdit('/things/edit/missing', true, []);

      expect(await notFound()).toBeInTheDocument();
      expect(refusal()).not.toBeInTheDocument();
      expect(saveButton()).not.toBeInTheDocument();
    });

    it('still shows the add form to an account that holds the add permission when the route has no name', async () => {
      servePermissions({ own: [[ADD]] });
      renderGuardedEdit('/things/edit/_', true, []);

      expect(
        await screen.findByText('Creating a new thing'),
      ).toBeInTheDocument();
      expect(saveButton()).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: '404 - Page not found' }),
      ).not.toBeInTheDocument();
    });

    it('shows the loading state, not the not-found page, while the object is being read', async () => {
      servePermissions({ own: [[ADD]] });
      const Thing = Guarded();
      server.use(
        http.get(`*${THINGS}`, async () => {
          await delay(150);
          return HttpResponse.json(page([]));
        }),
      );
      renderWithProviders(
        <AppContextProvider>
          <Routes>
            <Route path='/things/edit/:name' element={<Thing />} />
          </Routes>
        </AppContextProvider>,
        { route: '/things/edit/missing' },
      );

      await screen.findByRole('progressbar');
      expect(
        screen.queryByRole('heading', { name: '404 - Page not found' }),
      ).not.toBeInTheDocument();
      expect(form()).not.toBeInTheDocument();
      expect(await notFound()).toBeInTheDocument();
    });
  });
});

describe('every repository and remote edit page opened by its address', () => {
  const API = '/pulp/api/v3';

  // route: where the page is mounted; list: the collection its object is read
  // from; view: a permission the account holds that is not the edit permission
  const pages = [
    {
      name: 'ansible remote',
      Edit: AnsibleRemoteEdit,
      route: Paths.ansible.remote.edit,
      list: 'remotes/ansible/collection/',
    },
    {
      name: 'ansible repository',
      Edit: AnsibleRepositoryEdit,
      route: Paths.ansible.repository.edit,
      list: 'repositories/ansible/ansible/',
    },
    {
      name: 'python remote',
      Edit: PythonRemoteEdit,
      route: Paths.python.remote.edit,
      list: 'remotes/python/python/',
    },
    {
      name: 'python repository',
      Edit: PythonRepositoryEdit,
      route: Paths.python.repository.edit,
      list: 'repositories/python/python/',
    },
    {
      name: 'rpm remote',
      Edit: RPMRemoteEdit,
      route: Paths.rpm.remote.edit,
      list: 'remotes/rpm/rpm/',
    },
    {
      name: 'rpm repository',
      Edit: RPMRepositoryEdit,
      route: Paths.rpm.repository.edit,
      list: 'repositories/rpm/rpm/',
    },
  ];

  const hrefOf = ({ list }: { list: string }) =>
    `${API}/${list}00000000-0000-4000-8000-000000000001/`;

  const fill = (path: string) => path.replace(':name', 'existing');

  function renderPage(
    { Edit, route, list }: (typeof pages)[number],
    at: string,
  ) {
    const href = hrefOf({ list });
    server.use(
      http.get(`*${API}/${list}`, () =>
        HttpResponse.json(page([{ name: 'existing', pulp_href: href }])),
      ),
    );
    return {
      href,
      ...renderWithProviders(
        <AppContextProvider>
          <Routes>
            <Route path={route} element={<Edit />} />
          </Routes>
        </AppContextProvider>,
        { route: at },
      ),
    };
  }

  const saveButton = () => screen.queryByRole('button', { name: 'Save' });
  const settled = () => act(() => new Promise((r) => setTimeout(r, 120)));

  // every read of a form that a test does not serve answers an empty list; it
  // is registered first so that the handlers of a test take precedence
  beforeEach(() => {
    server.use(http.get(`*${API}/*`, () => HttpResponse.json(page([]))));
  });

  afterEach(() => {
    server.events.removeAllListeners();
  });

  it.each(pages)(
    'shows the insufficient permissions page and no Save button for the $name to an account without its change permission',
    async (row) => {
      servePermissions({ own: [['core.view_task']] });
      serveMyPermissions({ [hrefOf(row)]: ['core.view_task'] });
      const recorded = recordWrites();
      renderPage(row, fill(row.route));

      expect(
        await screen.findByRole('heading', {
          name: 'Insufficient permissions',
        }),
      ).toBeInTheDocument();
      expect(saveButton()).not.toBeInTheDocument();
      await settled();
      expect(recorded.writes).toEqual([]);
      recorded.stop();
    },
  );

  it.each(pages)(
    'shows the insufficient permissions page and no Save button for the $name add page to an account without its add permission',
    async (row) => {
      servePermissions({ own: [['core.view_task']] });
      renderPage(row, row.route.replace(':name', '_'));

      expect(
        await screen.findByRole('heading', {
          name: 'Insufficient permissions',
        }),
      ).toBeInTheDocument();
      expect(saveButton()).not.toBeInTheDocument();
    },
  );

  it.each(pages)(
    'shows the not-found page, no form and no write for the $name edit address of a name the list does not return, to an account that holds its add permission',
    async (row) => {
      const [plugin, kind] = row.name.split(' ') as [
        PermissionPlugin,
        'remote' | 'repository',
      ];
      servePermissions({ own: [[ACTION_PERMISSIONS[plugin][kind].add]] });
      const recorded = recordWrites();
      // the list answers an empty page for every name (see beforeEach)
      renderWithProviders(
        <AppContextProvider>
          <Routes>
            <Route path={row.route} element={<row.Edit />} />
          </Routes>
        </AppContextProvider>,
        { route: row.route.replace(':name', 'no-such-name') },
      );

      expect(
        await screen.findByRole('heading', { name: '404 - Page not found' }),
      ).toBeInTheDocument();
      expect(saveButton()).not.toBeInTheDocument();
      expect(
        screen.queryByRole('textbox', { name: /^Name/ }),
      ).not.toBeInTheDocument();
      await settled();
      expect(recorded.writes).toEqual([]);
      recorded.stop();
    },
  );

  it.each(pages)(
    'shows the $name form with Save to staff, for an existing object and for a new one',
    async (row) => {
      servePermissions({ isStaff: true });
      serveMyPermissions({ [hrefOf(row)]: [] });
      const existing = renderPage(row, fill(row.route));

      expect(await screen.findByDisplayValue('existing')).toBeInTheDocument();
      expect(saveButton()).toBeInTheDocument();
      existing.unmount();

      renderPage(row, row.route.replace(':name', '_'));

      expect(
        await screen.findByRole('textbox', { name: /^Name/ }),
      ).toBeInTheDocument();
      expect(saveButton()).toBeInTheDocument();
    },
  );
});

describe('an edit page, for an action that outlives it', () => {
  it('tells the action whether the page is still shown', async () => {
    server.use(answer('alpha'));
    const view = renderEdit('/things/edit/alpha');
    await screen.findByText('Editing alpha');

    expect(actionContext.isMounted()).toBe(true);
    view.unmount();

    expect(actionContext.isMounted()).toBe(false);
  });
});
