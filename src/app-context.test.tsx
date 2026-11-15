import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from './app-context';
import { renderWithProviders } from './test-utils/render';

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
