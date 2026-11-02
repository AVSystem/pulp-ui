import { screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { listOf, repository, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { debRepositorySyncAction } from './deb-repository-sync';
import { pythonRepositorySyncAction } from './python-repository-sync';
import { rpmRepositorySyncAction } from './rpm-repository-sync';

const API = '/pulp/api/v3';

// The action keeps its dialog state in the page that renders it, so a small
// parent plays that part.
function Harness({
  action,
  item,
}: {
  action: typeof debRepositorySyncAction;
  item: object;
}) {
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
      {action.button(item, context)}
      {action.modal(context)}
    </>
  );
}

describe.each([
  [
    'deb',
    debRepositorySyncAction,
    'pulp_deb.app.tasks.synchronizing.synchronize',
  ],
  [
    'rpm',
    rpmRepositorySyncAction,
    'pulp_rpm.app.tasks.synchronizing.synchronize',
  ],
  ['python', pythonRepositorySyncAction, 'pulp_python.app.tasks.sync.sync'],
] as const)('syncing a %s repository', (_plugin, action, syncTaskName) => {
  it('disables Sync while a sync of the repository is already running', async () => {
    const queries = listOf(`${API}/tasks/`, [
      task({ state: 'running', name: syncTaskName }),
    ]);
    server.use(queries.handler);
    const item = repository({
      remote: `${API}/remotes/x/y/00000000-0000-4000-8000-0000000000b1/`,
    });
    const { user } = renderWithProviders(
      <Harness action={action} item={item} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Sync' }));
    const dialog = await screen.findByRole('dialog');

    expect(
      await within(dialog).findByText(
        'A sync of this repository is already running.',
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /^Sync/ }),
    ).toBeDisabled();
    expect(queries.queries[0].get('exclusive_resources')).toBe(item.pulp_href);
  });

  it('keeps Sync enabled when no task holds the repository', async () => {
    const queries = listOf(`${API}/tasks/`, []);
    server.use(queries.handler);
    const item = repository({
      remote: `${API}/remotes/x/y/00000000-0000-4000-8000-0000000000b1/`,
    });
    const { user } = renderWithProviders(
      <Harness action={action} item={item} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Sync' }));
    const dialog = await screen.findByRole('dialog');

    await vi.waitFor(() => expect(queries.queries).toHaveLength(1));
    expect(within(dialog).getByRole('button', { name: /^Sync/ })).toBeEnabled();
  });
});
