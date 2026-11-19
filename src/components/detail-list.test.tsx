import { msg } from '@lingui/core/macro';
import { Td, Tr } from '@patternfly/react-table';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type FilterOption } from 'src/components';
import { Action, type ActionType } from '../actions/action';
import { PulpAPI } from '../api/pulp';
import { resetSessionEvents, setSignedIn } from '../session/session-events';
import { listOf } from '../test-utils/pulp';
import { renderWithProviders } from '../test-utils/render';
import { server } from '../test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from '../test-utils/sign-in-again';
import { DetailList } from './detail-list';

const THINGS = '/pulp/api/v3/things/';

interface IThing {
  name: string;
}

const things = new PulpAPI();

function renderList({
  strict = false,
  filterConfig,
  hasPermission = () => true,
  headerActions,
  noDataButton,
}: {
  strict?: boolean;
  filterConfig?: FilterOption[];
  hasPermission?: (name: string) => boolean;
  headerActions?: ActionType[];
  noDataButton?: (item, actionContext) => ReactNode;
} = {}) {
  const addAlert = vi.fn();
  const list = (
    <DetailList<IThing>
      actionContext={{ addAlert, hasPermission, query: vi.fn() }}
      defaultPageSize={10}
      errorTitle='Things could not be displayed.'
      filterConfig={filterConfig}
      headerActions={headerActions}
      noDataButton={noDataButton}
      noDataDescription='Things appear once they are created.'
      noDataTitle='No things yet'
      query={({ params }) => things.list('things/', params)}
      renderTableRow={(item) => (
        <Tr key={item.name}>
          <Td>{item.name}</Td>
        </Tr>
      )}
      sortHeaders={[{ title: 'Name', type: 'alpha', id: 'name' }]}
      title='Things'
    />
  );
  return {
    addAlert,
    ...renderWithProviders(strict ? <StrictMode>{list}</StrictMode> : list),
  };
}

const rows = (...names: string[]) => names.map((name) => ({ name }));

const failing = (status: number, statusText: string) =>
  http.get(`*${THINGS}`, () =>
    HttpResponse.json({ detail: 'no' }, { status, statusText }),
  );

describe('a list in a detail tab whose load fails', () => {
  it('shows the error state with Retry and raises no alert, for a network error', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    const { addAlert } = renderList();

    expect(
      await screen.findByRole('heading', {
        name: 'Things could not be displayed.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No things yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(addAlert).not.toHaveBeenCalled();
  });

  it('shows the status of a failed answer', async () => {
    server.use(failing(503, 'Service Unavailable'));
    const { addAlert } = renderList();

    expect(
      await screen.findByText('Error 503 - Service Unavailable'),
    ).toBeInTheDocument();
    expect(addAlert).not.toHaveBeenCalled();
  });

  it('shows the error state with Retry for the 401 a visitor gets', async () => {
    server.use(failing(401, 'Unauthorized'));
    const { addAlert } = renderList();

    expect(
      await screen.findByText('Error 401 - Unauthorized'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(addAlert).not.toHaveBeenCalled();
  });

  it('keeps its loading state without an error state or alert for the 401 of a signed-in user', async () => {
    server.use(failing(401, 'Unauthorized'));
    const { addAlert } = renderList();
    setSignedIn(true);

    await waitFor(() => expect(screen.getByRole('progressbar')).toBeVisible());
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
    expect(screen.queryByText('No things yet')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Things could not be displayed.' }),
    ).not.toBeInTheDocument();
    expect(addAlert).not.toHaveBeenCalled();
  });

  it('shows the rows once Retry finds the API again', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    const { user } = renderList();
    await screen.findByRole('button', { name: 'Retry' });

    server.use(listOf(THINGS, rows('alpha', 'beta')).handler);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('replaces the message when Retry fails again', async () => {
    server.use(failing(503, 'Service Unavailable'));
    const { user } = renderList();
    await screen.findByText(/Error 503/);

    server.use(failing(502, 'Bad Gateway'));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/Error 502/)).toBeInTheDocument();
    expect(screen.queryByText(/Error 503/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  it('shows one error state under StrictMode', async () => {
    server.use(failing(503, 'Service Unavailable'));
    const { addAlert } = renderList({ strict: true });

    expect(await screen.findByText(/Error 503/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(addAlert).not.toHaveBeenCalled();
  });
});

describe('a list in a detail tab whose load succeeds', () => {
  it('shows the normal empty state for an empty list', async () => {
    server.use(listOf(THINGS, []).handler);
    renderList();

    expect(await screen.findByText('No things yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('shows the rows', async () => {
    server.use(listOf(THINGS, rows('alpha')).handler);
    renderList();

    expect(await screen.findByText('alpha')).toBeInTheDocument();
  });
});

const addThing = Action({
  title: msg`Add thing`,
  permission: 'things.add_thing',
  objectLevel: false,
  onClick: vi.fn(),
});

const NAME_FILTER: FilterOption[] = [{ id: 'name', title: 'Name' }];

const toolbarItems = () =>
  Array.from(
    (
      document.querySelector('[data-cy="DetailList"]') as HTMLElement
    ).querySelectorAll('.pf-v6-c-toolbar__item'),
  );

describe('the header actions of a list in a detail tab', () => {
  it('draws no stray 0 and no empty toolbar item for an empty list of actions', async () => {
    server.use(listOf(THINGS, rows('alpha')).handler);
    renderList({ filterConfig: NAME_FILTER, headerActions: [] });

    await screen.findByText('alpha');

    expect(
      within(
        document.querySelector('.pf-v6-c-toolbar') as HTMLElement,
      ).queryByText('0'),
    ).toBeNull();
    expect(toolbarItems().every((item) => item.childElementCount > 0)).toBe(
      true,
    );
  });

  it('draws no toolbar item for an action that is hidden', async () => {
    server.use(listOf(THINGS, rows('alpha')).handler);
    renderList({
      filterConfig: NAME_FILTER,
      headerActions: [addThing],
      hasPermission: () => false,
    });

    await screen.findByText('alpha');

    expect(screen.queryByRole('button', { name: 'Add thing' })).toBeNull();
    expect(toolbarItems().every((item) => item.childElementCount > 0)).toBe(
      true,
    );
  });

  it('draws the button of an action that is shown', async () => {
    server.use(listOf(THINGS, rows('alpha')).handler);
    renderList({ headerActions: [addThing] });

    expect(
      await screen.findByRole('button', { name: 'Add thing' }),
    ).toBeInTheDocument();
  });
});

describe('the empty state of a list in a detail tab', () => {
  it('has no actions area when the button renders nothing', async () => {
    server.use(listOf(THINGS, []).handler);
    renderList({
      hasPermission: () => false,
      noDataButton: (item, actionContext) =>
        addThing.button(item, actionContext),
    });

    await screen.findByText('No things yet');

    expect(document.querySelector('.pf-v6-c-empty-state__actions')).toBeNull();
    expect(document.querySelector('.pf-v6-c-empty-state__footer')).toBeNull();
  });

  it('draws the button when there is one', async () => {
    server.use(listOf(THINGS, []).handler);
    renderList({
      noDataButton: (item, actionContext) =>
        addThing.button(item, actionContext),
    });

    expect(
      await screen.findByRole('button', { name: 'Add thing' }),
    ).toBeInTheDocument();
  });
});

describe('a list in a detail tab after the same user signs in again', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  function renderAfterSignIn() {
    serveSignIn();
    const { addAlert } = { addAlert: vi.fn() };
    return renderWithProviders(
      <>
        <SignInAgain />
        <DetailList<IThing>
          actionContext={{
            addAlert,
            hasPermission: () => true,
            query: vi.fn(),
          }}
          defaultPageSize={10}
          errorTitle='Things could not be displayed.'
          noDataDescription='Things appear once they are created.'
          noDataTitle='No things yet'
          query={({ params }) => things.list('things/', params)}
          renderTableRow={(item) => (
            <Tr key={item.name}>
              <Td>{item.name}</Td>
            </Tr>
          )}
          sortHeaders={[{ title: 'Name', type: 'alpha', id: 'name' }]}
          title='Things'
        />
      </>,
      { signedIn: true },
    );
  }

  it('reads again with the same parameters and shows the fresh rows', async () => {
    const { handler, queries } = listOf(THINGS, rows('alpha'));
    server.use(handler);
    const { user } = renderAfterSignIn();
    await screen.findByText('alpha');
    await signedIn();
    const fresh = listOf(THINGS, rows('beta'));
    server.use(fresh.handler);

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText('beta')).toBeVisible();
    expect(screen.queryByText('alpha')).not.toBeInTheDocument();
    expect(fresh.queries).toHaveLength(1);
    expect(fresh.queries[0]).toEqual(queries[0]);
  });

  it('keeps the rows and shows no error state when the read is refused with 401', async () => {
    server.use(listOf(THINGS, rows('alpha')).handler);
    const { user } = renderAfterSignIn();
    await screen.findByText('alpha');
    await signedIn();
    server.use(failing(401, 'Unauthorized'));

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

    expect(screen.getByText('alpha')).toBeVisible();
    expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
  });

  it('shows the rows after a first read that was refused', async () => {
    server.use(failing(401, 'Unauthorized'));
    const { user } = renderAfterSignIn();
    await signedIn();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    expect(screen.getByRole('progressbar')).toBeVisible();
    server.use(listOf(THINGS, rows('beta')).handler);

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText('beta')).toBeVisible();
    expect(screen.queryByText(/Error 401/)).not.toBeInTheDocument();
  });

  it('reads a list that shows an error state again like a first visit', async () => {
    server.use(failing(503, 'Service Unavailable'));
    const { user } = renderAfterSignIn();
    await screen.findByText(/Error 503/);
    await signedIn();
    server.use(listOf(THINGS, rows('beta')).handler);

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText('beta')).toBeVisible();
    expect(screen.queryByText(/Error 503/)).not.toBeInTheDocument();
  });
});
