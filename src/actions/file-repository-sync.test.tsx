import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePermissions } from 'src/permissions';
import { servePermissions } from 'src/test-utils/permissions';
import { listOf, repository, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { fileRepositorySyncAction } from './file-repository-sync';

const API = '/pulp/api/v3';

// The action keeps its dialog state in the page that renders it, so a small
// parent plays that part.
function Harness({ item }: { item: object }) {
  const [state, setState] = useState<Record<string, unknown>>({});
  const { hasPermission } = usePermissions();
  const context = {
    addAlert: vi.fn(),
    hasPermission,
    listQuery: vi.fn(),
    query: vi.fn(),
    reloadPage: vi.fn(),
    setState: (next: Record<string, unknown>) =>
      setState((old) => ({ ...old, ...next })),
    state,
  };
  return (
    <>
      {fileRepositorySyncAction.button(item, context)}
      {fileRepositorySyncAction.modal(context)}
    </>
  );
}

const REMOTE = `${API}/remotes/file/file/00000000-0000-4000-8000-0000000000b1/`;

async function openDialog(
  user: ReturnType<typeof renderWithProviders>['user'],
) {
  await user.click(await screen.findByRole('button', { name: 'Sync' }));
  return screen.findByRole('dialog');
}

function serveSync(running: object[] = []) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    listOf(`${API}/tasks/`, running).handler,
    http.post(
      `*${API}/repositories/file/file/:id/sync/`,
      async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ task: task().pulp_href }, { status: 202 });
      },
    ),
  );
  return bodies;
}

const mirrorSwitch = () =>
  screen.getByRole('switch', {
    name: /Content not present in remote|Sync will only add/,
  });

let recorder: { stop: () => void } | undefined;

afterEach(() => {
  recorder?.stop();
  recorder = undefined;
});

// A user whose own role lets them sync file repositories.
function signInAsSyncer() {
  recorder = servePermissions({ own: [['file.sync_filerepository']] });
}

describe('the sync action of file repositories', () => {
  it('is offered to a holder of the sync permission', async () => {
    signInAsSyncer();
    renderWithProviders(<Harness item={repository({ remote: REMOTE })} />);

    expect(
      await screen.findByRole('button', { name: 'Sync' }),
    ).toBeInTheDocument();
  });

  it('is absent for a user who may only change a repository', async () => {
    recorder = servePermissions({ own: [['file.change_filerepository']] });
    renderWithProviders(<Harness item={repository({ remote: REMOTE })} />);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull(),
    );
    // give the permission read time to answer, then check again
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull();
    expect(screen.queryByText('Sync')).toBeNull();
  });

  it('is absent, not disabled, while the permission read is pending', async () => {
    recorder = servePermissions({ own: [['file.sync_filerepository']] });
    server.use(
      http.get(`*${API}/users/7/`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json({ id: 7, is_staff: true, groups: [] });
      }),
    );
    renderWithProviders(<Harness item={repository({ remote: REMOTE })} />);

    expect(screen.queryByText('Sync')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Sync' })).toBeEnabled();
  });
});

describe('syncing a file repository', () => {
  beforeEach(signInAsSyncer);

  it('starts with mirror on for a repository that does not autopublish', async () => {
    const bodies = serveSync();
    const item = repository({ remote: REMOTE, autopublish: false });
    const { user } = renderWithProviders(<Harness item={item} />);

    const dialog = await openDialog(user);
    expect(mirrorSwitch()).toBeChecked();
    expect(mirrorSwitch()).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: /^Sync/ }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ mirror: true });
  });

  it('starts with mirror off, locked, and sends mirror false for a repository that autopublishes', async () => {
    const bodies = serveSync();
    const item = repository({ remote: REMOTE, autopublish: true });
    const { user } = renderWithProviders(<Harness item={item} />);

    const dialog = await openDialog(user);
    expect(mirrorSwitch()).not.toBeChecked();
    expect(mirrorSwitch()).toBeDisabled();
    expect(
      screen.getByText(/Mirroring cannot be combined with autopublish/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /^Sync/ }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ mirror: false });
  });

  it('disables Sync while a task of the repository is already running', async () => {
    const bodies = serveSync([
      task({
        state: 'running',
        name: 'pulp_file.app.tasks.synchronizing.synchronize',
      }),
    ]);
    const item = repository({ remote: REMOTE, autopublish: false });
    const { user } = renderWithProviders(<Harness item={item} />);

    const dialog = await openDialog(user);
    expect(
      await within(dialog).findByText(
        'A sync of this repository is already running.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /^Sync/ }),
    ).toBeDisabled();
    expect(bodies).toHaveLength(0);
  });
});
