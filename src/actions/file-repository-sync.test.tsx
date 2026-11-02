import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { repository, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { fileRepositorySyncAction } from './file-repository-sync';

const API = '/pulp/api/v3';

// The action keeps its dialog state in the page that renders it, so a small
// parent plays that part.
function Harness({ item }: { item: object }) {
  const [state, setState] = useState<Record<string, unknown>>({});
  const context = {
    addAlert: vi.fn(),
    hasPermission: () => true,
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

function serveSync() {
  const bodies: Record<string, unknown>[] = [];
  server.use(
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
  screen.getByRole('checkbox', {
    name: /Content not present in remote|Sync will only add/,
  });

describe('syncing a file repository', () => {
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
});
