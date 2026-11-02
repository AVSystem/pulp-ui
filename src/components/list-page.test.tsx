import { msg } from '@lingui/core/macro';
import { Td, Tr } from '@patternfly/react-table';
import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PulpAPI } from '../api/pulp';
import { AppContextProvider } from '../app-context';
import { listOf, page } from '../test-utils/pulp';
import { renderWithProviders } from '../test-utils/render';
import { server } from '../test-utils/server';
import { ListPage } from './list-page';

const THINGS = '/pulp/api/v3/things/';

interface IThing {
  name: string;
}

const things = new PulpAPI();

let actionContext;

const ThingList = ListPage<IThing>({
  defaultPageSize: 10,
  displayName: 'ThingList',
  errorTitle: msg`Things could not be displayed.`,
  filterConfig: () => [{ id: 'name__icontains', title: 'Name' }],
  noDataButton: () => <button type='button'>Create thing</button>,
  noDataDescription: msg`Things appear once they are created.`,
  noDataTitle: msg`No things yet`,
  query: ({ params }) => things.list('things/', params),
  renderTableRow: (item, index, context) => {
    actionContext = context;
    return (
      <Tr key={item.name}>
        <Td>{item.name}</Td>
      </Tr>
    );
  },
  sortHeaders: [{ title: msg`Name`, type: 'alpha', id: 'name' }],
  title: msg`Things`,
});

function renderList() {
  return renderWithProviders(
    <AppContextProvider>
      <ThingList />
    </AppContextProvider>,
  );
}

const rows = (...names: string[]) => names.map((name) => ({ name }));

const failing = (status: number, statusText: string) =>
  http.get(`*${THINGS}`, () =>
    HttpResponse.json({ detail: 'no' }, { status, statusText }),
  );

const retry = () => screen.getByRole('button', { name: 'Retry' });
const spinner = () => screen.queryByRole('progressbar');
const errorStates = () => screen.queryAllByRole('button', { name: 'Retry' });

afterEach(() => {
  actionContext = undefined;
});

describe('a list page whose API cannot be reached', () => {
  it('shows the page error title, the message and a Retry button instead of a spinner', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    renderList();

    expect(
      await screen.findByRole('heading', {
        name: 'Things could not be displayed.',
      }),
    ).toBeInTheDocument();
    expect(retry()).toBeInTheDocument();
    expect(screen.getByText(/network|failed|fetch/i)).toBeInTheDocument();
    expect(spinner()).not.toBeInTheDocument();
  });

  it('does not offer the empty state with its Create button', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    renderList();

    await screen.findByRole('button', { name: 'Retry' });
    expect(screen.queryByText('No things yet')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Create thing' }),
    ).not.toBeInTheDocument();
  });

  it('adds no alert for the failed load, so the failure is shown once', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    renderList();

    await screen.findByRole('button', { name: 'Retry' });
    expect(
      screen.queryAllByText('Things could not be displayed.'),
    ).toHaveLength(1);
  });

  it('shows the rows once the API answers after Retry', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    const { user } = renderList();
    await screen.findByRole('button', { name: 'Retry' });

    server.use(listOf(THINGS, rows('alpha', 'beta')).handler);
    await user.click(retry());

    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Things could not be displayed.' }),
    ).not.toBeInTheDocument();
  });

  it('replaces the message with the latest one when Retry fails again', async () => {
    server.use(failing(503, 'Service Unavailable'));
    const { user } = renderList();
    expect(await screen.findByText(/Error 503/)).toBeInTheDocument();

    server.use(failing(502, 'Bad Gateway'));
    await user.click(retry());

    expect(
      await screen.findByText(/Error 502 - Bad Gateway/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Error 503/)).not.toBeInTheDocument();
    expect(errorStates()).toHaveLength(1);
  });
});

describe('a list page whose API answers with an error status', () => {
  it('shows the status code and status text of a 503 unchanged', async () => {
    server.use(failing(503, 'Service Unavailable'));
    renderList();

    expect(
      await screen.findByText('Error 503 - Service Unavailable'),
    ).toBeInTheDocument();
    expect(retry()).toBeInTheDocument();
  });

  it('shows the 500 status for a server error', async () => {
    server.use(failing(500, 'Internal Server Error'));
    renderList();

    expect(await screen.findByText(/Error 500 - /)).toBeInTheDocument();
    expect(retry()).toBeInTheDocument();
  });

  it('shows the error state, not a not-found page, for a 404', async () => {
    server.use(failing(404, 'Not Found'));
    renderList();

    expect(await screen.findByText(/Error 404 - /)).toBeInTheDocument();
    expect(retry()).toBeInTheDocument();
  });

  it('keeps the sign-in link for a 401', async () => {
    server.use(failing(401, 'Unauthorized'));
    renderList();

    expect(await screen.findByText(/Error 401 - /)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument();
    expect(retry()).toBeInTheDocument();
  });

  it('never shows the response body', async () => {
    server.use(
      http.get(`*${THINGS}`, () =>
        HttpResponse.json(
          { detail: 'secret-body-text' },
          { status: 500, statusText: 'Internal Server Error' },
        ),
      ),
    );
    renderList();

    await screen.findByText(/Error 500 - /);
    expect(screen.queryByText(/secret-body-text/)).not.toBeInTheDocument();
  });
});

describe('a list page whose API answers', () => {
  it('shows the normal empty state, not the error state, for an empty list', async () => {
    server.use(listOf(THINGS, []).handler);
    renderList();

    expect(await screen.findByText('No things yet')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create thing' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('shows the rows without an error state', async () => {
    server.use(listOf(THINGS, rows('alpha')).handler);
    renderList();

    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });
});

describe('a list page that loads more than once', () => {
  it('shows the outcome of the newest request when an older failure arrives last', async () => {
    let calls = 0;
    server.use(
      http.get(`*${THINGS}`, async () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(page(rows('first')));
        }
        if (calls === 2) {
          await delay(150);
          return HttpResponse.json({ detail: 'late' }, { status: 503 });
        }
        return HttpResponse.json(page(rows('newest')));
      }),
    );
    renderList();
    await screen.findByText('first');

    act(() => {
      actionContext.query();
      actionContext.query();
    });

    expect(await screen.findByText('newest')).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(calls).toBe(3);
    expect(screen.getByText('newest')).toBeInTheDocument();
    expect(screen.queryByText(/Error 503/)).not.toBeInTheDocument();
  });

  it('shows the newest failure when an older answer arrives last', async () => {
    let calls = 0;
    server.use(
      http.get(`*${THINGS}`, async () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(page(rows('first')));
        }
        if (calls === 2) {
          await delay(150);
          return HttpResponse.json(page(rows('late')));
        }
        return HttpResponse.json({ detail: 'no' }, { status: 503 });
      }),
    );
    renderList();
    await screen.findByText('first');

    act(() => {
      actionContext.query();
      actionContext.query();
    });

    expect(await screen.findByText(/Error 503/)).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    await waitFor(() => expect(calls).toBe(3));
    expect(screen.getByText(/Error 503/)).toBeInTheDocument();
    expect(screen.queryByText('late')).not.toBeInTheDocument();
  });
});

describe('a list page mounted in the development setup', () => {
  it('shows one error state and no alert for a failing list under StrictMode', async () => {
    server.use(failing(503, 'Service Unavailable'));
    renderWithProviders(
      <StrictMode>
        <AppContextProvider>
          <ThingList />
        </AppContextProvider>
      </StrictMode>,
    );

    expect(await screen.findByText(/Error 503/)).toBeInTheDocument();
    expect(errorStates()).toHaveLength(1);
    expect(screen.getAllByText(/Error 503/)).toHaveLength(1);
    expect(screen.getAllByText('Things could not be displayed.')).toHaveLength(
      1,
    );
  });

  it('shows the rows once under StrictMode', async () => {
    server.use(listOf(THINGS, rows('alpha')).handler);
    renderWithProviders(
      <StrictMode>
        <AppContextProvider>
          <ThingList />
        </AppContextProvider>
      </StrictMode>,
    );

    expect(await screen.findAllByText('alpha')).toHaveLength(1);
  });

  it('sends exactly one list request when it mounts', async () => {
    const { handler, queries } = listOf(THINGS, rows('alpha'));
    server.use(handler);
    renderList();

    await screen.findByText('alpha');
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(queries).toHaveLength(1);
  });

  it('sends exactly one list request when it mounts and the list fails', async () => {
    let requests = 0;
    server.use(
      http.get(`*${THINGS}`, () => {
        requests += 1;
        return HttpResponse.error();
      }),
    );
    renderList();

    await screen.findByRole('button', { name: 'Retry' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(requests).toBe(1);
  });

  it('sends one more request for each Retry and none on its own', async () => {
    let requests = 0;
    server.use(
      http.get(`*${THINGS}`, () => {
        requests += 1;
        return HttpResponse.error();
      }),
    );
    const { user } = renderList();
    await screen.findByRole('button', { name: 'Retry' });

    await user.click(retry());
    await waitFor(() => expect(requests).toBe(2));
    await screen.findByRole('button', { name: 'Retry' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(requests).toBe(2);
  });
});
