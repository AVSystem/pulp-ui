import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { listOf, repository, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { fileRepositoryDeleteAction } from './file-repository-delete';

const API = '/pulp/api/v3';

interface Open {
  name: string;
  pulp_href: string;
  pulpId: string;
}
interface State {
  deleteModalOpen?: Open | null;
}

const opened = (repo: { name: string; pulp_href: string }): Open => ({
  name: repo.name,
  pulp_href: repo.pulp_href,
  pulpId: repo.pulp_href.split('/').filter(Boolean).pop(),
});

// The action keeps its dialog state in the page that renders it. A small
// parent plays that part the way the pages do: an update is an object or a
// function of the current state, and a button stands for the user opening
// another repository's dialog.
function Harness({
  first,
  second,
  addAlert,
}: {
  first: { name: string; pulp_href: string };
  second: { name: string; pulp_href: string };
  addAlert: (alert) => void;
}) {
  const [state, setState] = useState<State>({
    deleteModalOpen: opened(first),
  });
  const context = {
    addAlert,
    hasPermission: () => true,
    listQuery: vi.fn(),
    query: vi.fn(),
    reloadPage: vi.fn(),
    setState: (next: State | ((old: State) => State | null)) =>
      setState((old) => ({
        ...old,
        ...(typeof next === 'function' ? next(old) : next),
      })),
    state,
  };
  return (
    <>
      <button
        onClick={() => context.setState({ deleteModalOpen: opened(second) })}
      >
        open second
      </button>
      {fileRepositoryDeleteAction.modal(context)}
    </>
  );
}

describe('the Delete action of a repository', () => {
  it('closes only its own dialog when a delete that outlived it finishes after another repository dialog was opened', async () => {
    const first = repository({ name: 'zz-first' });
    const second = repository({ name: 'zz-second' });
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      listOf(`${API}/distributions/file/file/`, []).handler,
      listOf(`${API}/publications/file/file/`, []).handler,
      http.delete(`*${API}/repositories/file/file/:id/`, () =>
        HttpResponse.json(
          { task: `${API}/tasks/00000000-0000-4000-8000-0000000000dd/` },
          { status: 202 },
        ),
      ),
      http.get(`*${API}/tasks/:id/`, async () => {
        await gate;
        return HttpResponse.json(
          task({
            pulp_href: `${API}/tasks/00000000-0000-4000-8000-0000000000dd/`,
            state: 'completed',
          }),
        );
      }),
    );
    const addAlert = vi.fn();
    const { user } = renderWithProviders(
      <Harness first={first} second={second} addAlert={addAlert} />,
    );

    await screen.findByText(/No distribution serves this repository/);
    await user.type(
      screen.getByLabelText(/Type the repository name/),
      'zz-first',
    );
    await user.click(screen.getByRole('button', { name: /^Delete/ }));

    // the page was left and another repository's dialog opened meanwhile
    await user.click(
      screen.getByRole('button', { name: 'open second', hidden: true }),
    );
    await screen.findByText('zz-second');

    release();
    await waitFor(() =>
      expect(addAlert).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Removed repository zz-first' }),
      ),
    );

    expect(screen.getByText('zz-second')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
