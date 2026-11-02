import { msg } from '@lingui/core/macro';
import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PulpAPI } from '../api/pulp';
import { AppContextProvider } from '../app-context';
import { page } from '../test-utils/pulp';
import { renderWithProviders } from '../test-utils/render';
import { server } from '../test-utils/server';
import { Page } from './page';

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

  it('keeps the sign-in link for a 401', async () => {
    server.use(failing(401, 'Unauthorized'));
    renderEdit('/things/edit/alpha');

    expect(await screen.findByText(/Error 401 - /)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument();
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
