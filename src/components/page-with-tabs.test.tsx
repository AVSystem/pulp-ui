import { msg } from '@lingui/core/macro';
import { act, screen } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { PulpAPI } from '../api/pulp';
import { AppContextProvider } from '../app-context';
import { page } from '../test-utils/pulp';
import { renderWithProviders } from '../test-utils/render';
import { server } from '../test-utils/server';
import { PageWithTabs } from './page-with-tabs';

const THINGS = '/pulp/api/v3/things/';

interface IThing {
  name: string;
}

const things = new PulpAPI();

let actionContext;

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
    return <p>{`Details of ${item.name}`}</p>;
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

  it('keeps the sign-in link for a 401', async () => {
    server.use(failing(401, 'Unauthorized'));
    renderDetail();

    expect(await screen.findByText(/Error 401 - /)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument();
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
