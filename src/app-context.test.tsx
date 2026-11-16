import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from './app-context';
import { servePermissions } from './test-utils/permissions';
import { renderWithProviders } from './test-utils/render';
import { server } from './test-utils/server';

function Queue() {
  const { alerts, queueAlert } = useAppContext();

  return (
    <>
      <button
        type='button'
        onClick={() =>
          queueAlert({ id: 'refused:save', variant: 'danger', title: 'Save' })
        }
      >
        queue refused save
      </button>
      <button
        type='button'
        onClick={() =>
          queueAlert({
            id: 'refused:delete',
            variant: 'danger',
            title: 'Delete',
          })
        }
      >
        queue refused delete
      </button>
      <button
        type='button'
        onClick={() => queueAlert({ variant: 'success', title: 'Done' })}
      >
        queue done
      </button>
      <ul>
        {alerts.map((alert, i) => (
          <li key={i}>{alert.title}</li>
        ))}
      </ul>
    </>
  );
}

const shown = () =>
  screen.queryAllByRole('listitem').map((li) => li.textContent);

describe('the queued alerts', () => {
  it('keeps one alert when the same refusal is queued again while it is open', async () => {
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Queue />
      </AppContextProvider>,
    );

    await user.click(screen.getByText('queue refused save'));
    await user.click(screen.getByText('queue refused save'));

    expect(shown()).toEqual(['Save']);
  });

  it('keeps alerts of different refusals and alerts without an id', async () => {
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Queue />
      </AppContextProvider>,
    );

    await user.click(screen.getByText('queue refused save'));
    await user.click(screen.getByText('queue refused delete'));
    await user.click(screen.getByText('queue done'));
    await user.click(screen.getByText('queue done'));

    expect(shown()).toEqual(['Save', 'Delete', 'Done', 'Done']);
  });
});

describe('the staff answer of the app context', () => {
  function Staff() {
    const { isStaff, permissionsReady } = useAppContext();
    return (
      <p>
        {permissionsReady ? 'ready' : 'pending'} {isStaff ? 'staff' : 'regular'}
      </p>
    );
  }

  const renderStaff = () =>
    renderWithProviders(
      <AppContextProvider>
        <Staff />
      </AppContextProvider>,
    );

  it('is false while the permissions are not known', () => {
    servePermissions({ isStaff: true });
    renderStaff();

    expect(screen.getByText('pending regular')).toBeInTheDocument();
  });

  it('is true once the own record is known to be staff', async () => {
    servePermissions({ isStaff: true });
    renderStaff();

    expect(await screen.findByText('ready staff')).toBeInTheDocument();
  });

  it('stays false for an account that only holds roles', async () => {
    servePermissions({ own: [['core.delete_task']] });
    renderStaff();

    expect(await screen.findByText('ready regular')).toBeInTheDocument();
  });

  it('is false after the permission read failed', async () => {
    const { requests } = servePermissions({ isStaff: true });
    server.use(
      http.get('*/pulp/api/v3/users/7/', () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderStaff();

    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('pending regular')).toBeInTheDocument();
  });
});
