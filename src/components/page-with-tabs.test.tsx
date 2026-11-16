import { msg } from '@lingui/core/macro';
import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { useState } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { Action } from '../actions/action';
import { PulpAPI } from '../api/pulp';
import { AppContextProvider } from '../app-context';
import { resetSessionEvents } from '../session/session-events';
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
import { PageWithTabs } from './page-with-tabs';

const THINGS = '/pulp/api/v3/things/';

interface IThing {
  name: string;
}

const things = new PulpAPI();

let actionContext;

// A tab that keeps a value of its own, as the tabs of the detail pages do.
const TabBody = ({ name }: { name: string }) => {
  const [note, setNote] = useState('');
  return (
    <>
      <p>{`Details of ${name}`}</p>
      <input
        aria-label='Note'
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </>
  );
};

const ThingDetail = PageWithTabs<IThing>({
  breadcrumbs: ({ name }) => [{ name: 'Things' }, { name }],
  displayName: 'ThingDetail',
  errorTitle: msg`Thing could not be displayed.`,
  listUrl: '/things',
  // the way the detail containers look an object up by name: the list answers
  // an empty page for a name that does not exist
  query: ({ name }) =>
    things.list('things/', { name, page_size: 1 }).then(({ data }) => {
      const [thing] = data.results;
      return thing ?? Promise.reject({ response: { status: 404 } });
    }),
  renderTab: (tab, item, context) => {
    actionContext = context;
    return <TabBody name={item.name} />;
  },
  tabs: () => [{ title: 'Details', link: '/', active: true }],
});

function renderDetail() {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route path='/things/:name' element={<ThingDetail />} />
      </Routes>
    </AppContextProvider>,
    { route: '/things/alpha' },
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

const NOT_FOUND = "We couldn't find the page you're looking for!";

afterEach(() => {
  actionContext = undefined;
});

describe('a detail page with tabs whose load fails', () => {
  it('shows the error state with Retry for a network error', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    renderDetail();

    expect(
      await screen.findByRole('heading', {
        name: 'Thing could not be displayed.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows the error state, not the not-found page, for a server error', async () => {
    server.use(failing(503, 'Service Unavailable'));
    renderDetail();

    expect(
      await screen.findByText('Error 503 - Service Unavailable'),
    ).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
  });

  it('shows the not-found page when the name is not found', async () => {
    server.use(answer());
    renderDetail();

    expect(await screen.findByText(NOT_FOUND)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('shows the not-found page when the server answers 404', async () => {
    server.use(failing(404, 'Not Found'));
    renderDetail();

    expect(await screen.findByText(NOT_FOUND)).toBeInTheDocument();
  });

  it('keeps its loading state without an error, alert or not-found page for a 401', async () => {
    server.use(failing(401, 'Unauthorized'));
    renderDetail();

    await waitFor(() => expect(screen.getByRole('progressbar')).toBeVisible());
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
    expect(screen.queryByText('Thing could not be displayed.')).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
  });

  it('shows the failure once, with no alert besides the error state', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    renderDetail();

    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getAllByText('Thing could not be displayed.')).toHaveLength(
      1,
    );
  });

  it('shows the tab once Retry finds the object', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    const { user } = renderDetail();
    await screen.findByRole('button', { name: 'Retry' });

    server.use(answer('alpha'));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Details of alpha')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('replaces the message when Retry fails again', async () => {
    server.use(failing(503, 'Service Unavailable'));
    const { user } = renderDetail();
    await screen.findByText(/Error 503/);

    server.use(failing(502, 'Bad Gateway'));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/Error 502/)).toBeInTheDocument();
    expect(screen.queryByText(/Error 503/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });
});

describe('a detail page with tabs that loads more than once', () => {
  it('keeps the object of the newest request when an older failure arrives last', async () => {
    let calls = 0;
    server.use(
      http.get(`*${THINGS}`, async () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(page([{ name: 'alpha' }]));
        }
        if (calls === 2) {
          await delay(150);
          return HttpResponse.json({ detail: 'late' }, { status: 503 });
        }
        return HttpResponse.json(page([{ name: 'alpha' }]));
      }),
    );
    renderDetail();
    await screen.findByText('Details of alpha');

    act(() => {
      actionContext.query();
      actionContext.query();
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));

    expect(calls).toBe(3);
    expect(screen.getByText('Details of alpha')).toBeInTheDocument();
    expect(screen.queryByText(/Error 503/)).not.toBeInTheDocument();
  });
});

function renderAfterSignIn() {
  serveSignIn();
  return renderWithProviders(
    <>
      <SignInAgain />
      <AppContextProvider>
        <Routes>
          <Route path='/things/:name' element={<ThingDetail />} />
        </Routes>
      </AppContextProvider>
    </>,
    { route: '/things/alpha' },
  );
}

// Answers one read after the other, the last answer repeating.
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

describe('a detail page with tabs after the same user signs in again', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  it('reads the object again without a loading state and keeps what the tab holds', async () => {
    const { handler, calls } = answers('alpha', 'alpha-2');
    server.use(handler);
    const { user } = renderAfterSignIn();
    await screen.findByText('Details of alpha');
    await signedIn();
    await user.type(screen.getByRole('textbox', { name: 'Note' }), 'draft');

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(calls()).toBe(2));

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(await screen.findByText('Details of alpha-2')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('draft');
  });

  it('sends no write besides the sign-in', async () => {
    server.use(answers('alpha').handler);
    const recorded = recordWrites();
    const { user } = renderAfterSignIn();
    await screen.findByText('Details of alpha');
    await signedIn();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 120)));

    expect(recorded.writes).toEqual(['POST /pulp/api/v3/login/']);
    recorded.stop();
  });

  it('keeps the page and adds one alert with the error title when the read fails', async () => {
    const { handler, calls } = answers(
      'alpha',
      HttpResponse.json({ detail: 'no' }, { status: 500 }),
    );
    server.use(handler);
    const { user } = renderAfterSignIn();
    await screen.findByText('Details of alpha');
    await signedIn();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(calls()).toBe(2));

    expect(await screen.findByText(/Error 500/)).toBeInTheDocument();
    expect(screen.getAllByText('Thing could not be displayed.')).toHaveLength(
      1,
    );
    expect(screen.getByText('Details of alpha')).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the page and adds no alert when the read is refused with 401', async () => {
    const { handler, calls } = answers(
      'alpha',
      HttpResponse.json({ detail: 'no' }, { status: 401 }),
    );
    server.use(handler);
    const { user } = renderAfterSignIn();
    await screen.findByText('Details of alpha');
    await signedIn();

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(calls()).toBe(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

    expect(screen.getByText('Details of alpha')).toBeInTheDocument();
    expect(screen.queryByText('Thing could not be displayed.')).toBeNull();
    expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
  });

  it('runs the first read again when it was refused, and shows the tab', async () => {
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

    expect(await screen.findByText('Details of alpha')).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
  });
});

describe('a detail page with tabs whose load is refused', () => {
  const Guarded = (condition?: () => boolean) =>
    PageWithTabs<IThing>({
      breadcrumbs: ({ name }) => [{ name: 'Things' }, { name }],
      condition,
      displayName: 'GuardedThingDetail',
      errorTitle: msg`Thing could not be displayed.`,
      headerActions: [
        Action({ title: msg`Delete thing`, onClick: () => undefined }),
      ],
      listUrl: '/things',
      query: ({ name }) =>
        things
          .list('things/', { name, page_size: 1 })
          .then(({ data }) => data.results[0]),
      renderTab: (_tab, item) => <p>{`Details of ${item.name}`}</p>,
      tabs: () => [{ title: 'Details', link: '/', active: true }],
    });

  function renderScreen(Screen: ReturnType<typeof Guarded>) {
    return renderWithProviders(
      <AppContextProvider>
        <Routes>
          <Route path='/things/:name' element={<Screen />} />
        </Routes>
      </AppContextProvider>,
      { route: '/things/alpha' },
    );
  }

  it('shows the insufficient permissions page with the server text, not the error state or the not-found page', async () => {
    server.use(failing(403, 'Forbidden'));
    renderDetail();

    expect(
      await screen.findByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You do not have permission to view this page.'),
    ).toBeInTheDocument();
    expect(screen.getByText('no')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
    expect(screen.queryByText('Details of alpha')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'alpha' })).toBeInTheDocument();
  });

  it('omits the detail paragraph for a 403 without a detail', async () => {
    server.use(
      http.get(`*${THINGS}`, () =>
        HttpResponse.json({}, { status: 403, statusText: 'Forbidden' }),
      ),
    );
    renderDetail();

    await screen.findByRole('heading', { name: 'Insufficient permissions' });
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
  });

  it('renders no header action for a refused read, and renders it for a shown object', async () => {
    const Screen = Guarded();

    server.use(failing(403, 'Forbidden'));
    const refused = renderScreen(Screen);
    await screen.findByRole('heading', { name: 'Insufficient permissions' });
    expect(
      screen.queryByRole('button', { name: 'Delete thing' }),
    ).not.toBeInTheDocument();
    refused.unmount();

    server.use(answer('alpha'));
    renderScreen(Screen);
    expect(
      await screen.findByRole('button', { name: 'Delete thing' }),
    ).toBeInTheDocument();
  });

  it('shows the same page without a detail when the screen condition is false', async () => {
    renderScreen(Guarded(() => false));

    await screen.findByRole('heading', { name: 'Insufficient permissions' });
    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: 'Delete thing' }),
    ).not.toBeInTheDocument();
  });
});

describe('a detail page with tabs whose header action needs a permission', () => {
  const HREF = '/pulp/api/v3/things/1/';
  const CHANGE = 'file.change_filerepository';

  const Permitted = PageWithTabs<IThing>({
    breadcrumbs: ({ name }) => [{ name: 'Things' }, { name }],
    displayName: 'PermittedThingDetail',
    errorTitle: msg`Thing could not be displayed.`,
    headerActions: [
      Action({
        title: msg`Change thing`,
        permission: CHANGE,
        onClick: () => undefined,
      }),
    ],
    listUrl: '/things',
    query: ({ name }) =>
      things
        .list('things/', { name, page_size: 1 })
        .then(({ data }) => data.results[0]),
    renderTab: (_tab, item) => <p>{`Details of ${item.name}`}</p>,
    tabs: () => [{ title: 'Details', link: '/', active: true }],
  });

  function renderScreen() {
    server.use(
      http.get(`*${THINGS}`, () =>
        HttpResponse.json(page([{ name: 'alpha', pulp_href: HREF }])),
      ),
    );
    return renderWithProviders(
      <AppContextProvider>
        <Routes>
          <Route path='/things/:name' element={<Permitted />} />
        </Routes>
      </AppContextProvider>,
      { route: '/things/alpha' },
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

  it('reads no object permissions for a staff user', async () => {
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

  it('keeps the action absent while the object permissions are read and when they fail', async () => {
    servePermissions({ own: [['file.view_filerepository']] });
    const { requests } = serveMyPermissions({
      [HREF]: { permissions: [CHANGE], delayMs: 200 },
    });
    const first = renderScreen();

    await screen.findByText('Details of alpha');
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(change()).not.toBeInTheDocument();
    await screen.findByRole('button', { name: 'Change thing' });
    first.unmount();

    serveMyPermissions({ [HREF]: { status: 500 } });
    renderScreen();
    await screen.findByText('Details of alpha');
    await settled();
    expect(change()).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('a detail page with tabs whose header actions are all hidden', () => {
  const HREF = '/pulp/api/v3/things/1/';

  const Hidden = PageWithTabs<IThing>({
    breadcrumbs: ({ name }) => [{ name: 'Things' }, { name }],
    displayName: 'HiddenActionsThingDetail',
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
    renderTab: (_tab, item) => <p>{`Details of ${item.name}`}</p>,
    tabs: () => [{ title: 'Details', link: '/', active: true }],
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
          <Route path='/things/:name' element={<Hidden />} />
        </Routes>
      </AppContextProvider>,
      { route: '/things/alpha' },
    );
  }

  afterEach(() => {
    server.events.removeAllListeners();
  });

  it('renders no action container, and renders it once an action is allowed', async () => {
    servePermissions({ own: [['file.view_filerepository']] });
    const hidden = renderHidden();

    await screen.findByText('Details of alpha');
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

describe('a detail page with tabs whose header action looks at the object', () => {
  const Downloadable = PageWithTabs<IThing & { file?: string }>({
    breadcrumbs: ({ name }) => [{ name: 'Things' }, { name }],
    displayName: 'DownloadableThingDetail',
    errorTitle: msg`Thing could not be displayed.`,
    headerActions: [
      Action({
        title: msg`Download requirements YAML`,
        // reads a field of the object, as the download actions of the remote
        // screens do
        visible: ({ file }) => !!file,
        onClick: () => undefined,
      }),
    ],
    listUrl: '/things',
    query: ({ name }) =>
      things
        .list('things/', { name, page_size: 1 })
        .then(({ data }) => data.results[0]),
    renderTab: (_tab, item) => <p>{`Details of ${item.name}`}</p>,
    tabs: () => [{ title: 'Details', link: '/', active: true }],
  });

  afterEach(() => {
    server.events.removeAllListeners();
  });

  function renderSlowObject(thing: object) {
    servePermissions({ isStaff: true });
    server.use(
      http.get(`*${THINGS}`, async () => {
        await delay(150);
        return HttpResponse.json(page([thing]));
      }),
    );
    return renderWithProviders(
      <AppContextProvider>
        <Routes>
          <Route path='/things/:name' element={<Downloadable />} />
        </Routes>
      </AppContextProvider>,
      { route: '/things/alpha' },
    );
  }

  it('draws no action and does not fail while the object is still being read', async () => {
    renderSlowObject({ name: 'alpha', file: 'content' });

    // permissions are known long before the object arrives
    await waitFor(() =>
      expect(screen.getByRole('heading')).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'Download requirements YAML' }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText('Details of alpha')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Download requirements YAML' }),
    ).toBeInTheDocument();
  });

  it('keeps the action away from an object that has nothing to download', async () => {
    renderSlowObject({ name: 'alpha' });

    expect(await screen.findByText('Details of alpha')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Download requirements YAML' }),
    ).not.toBeInTheDocument();
  });
});

describe('a detail page with tabs, for an action that outlives it', () => {
  it('tells the action whether the page is still shown', async () => {
    server.use(answer('alpha'));
    const view = renderDetail();
    await screen.findByText('Details of alpha');

    expect(actionContext.isMounted()).toBe(true);
    view.unmount();

    expect(actionContext.isMounted()).toBe(false);
  });
});
