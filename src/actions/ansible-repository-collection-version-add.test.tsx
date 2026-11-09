import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { listOf, repository, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { ansibleRepositoryCollectionVersionAddAction } from './ansible-repository-collection-version-add';

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000aa/`;

// A row of the plain content listing of collection versions: flat, with no
// repository and no nested collection version.
const row = (overrides: Record<string, unknown> = {}) => ({
  pulp_href: `${API}/content/ansible/collection_versions/00000000-0000-4000-8000-0000000000b1/`,
  namespace: 'ns',
  name: 'col',
  version: '1.0.0',
  description: 'A test collection',
  ...overrides,
});

// The page around the dialog: it holds the state the repository tab holds,
// opens the dialog for the repository and shows the alerts the dialog raises.
function Page({
  repo,
  reloadPage,
}: {
  repo: { name: string; pulp_href: string };
  reloadPage: () => void;
}) {
  const [state, setState] = useState({
    repository: repo,
    addCollectionVersionModal: {
      repositoryHref: repo.pulp_href,
      repositoryName: repo.name,
    },
  });
  const [alerts, setAlerts] = useState<{ title: ReactNode }[]>([]);

  return (
    <>
      <ul aria-label='alerts'>
        {alerts.map((alert, index) => (
          <li key={index}>{alert.title}</li>
        ))}
      </ul>
      {ansibleRepositoryCollectionVersionAddAction.modal({
        addAlert: (alert) => setAlerts((all) => [...all, alert]),
        listQuery: () => undefined,
        query: () => undefined,
        reloadPage,
        setState,
        state,
      })}
    </>
  );
}

// Serves the collection versions of the server, records the modify requests
// and answers the task of a modify with the given state. A modify answers
// after `modifyDelay` milliseconds.
function setup(
  rows: object[],
  {
    taskState = 'completed',
    modifyDelay = 0,
  }: { taskState?: string; modifyDelay?: number } = {},
) {
  const repo = repository({
    name: 'r1',
    pulp_href: `${API}/repositories/ansible/ansible/00000000-0000-4000-8000-0000000000a1/`,
  });
  const modifies: { path: string; body: unknown }[] = [];

  const list = listOf(`${API}/content/ansible/collection_versions/`, rows);
  server.use(
    list.handler,
    http.post(
      `*${API}/repositories/ansible/ansible/:id/modify/`,
      async ({ request }) => {
        modifies.push({
          path: new URL(request.url).pathname,
          body: await request.json(),
        });
        await new Promise((resolve) => setTimeout(resolve, modifyDelay));
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      },
    ),
    http.get(`*${TASK_HREF}`, () =>
      HttpResponse.json(
        task({
          pulp_href: TASK_HREF,
          state: taskState,
          error: taskState === 'failed' ? { description: 'Task broke.' } : null,
        }),
      ),
    ),
  );
  const reloadPage = vi.fn();

  const view = renderWithProviders(
    <Page repo={repo} reloadPage={reloadPage} />,
  );

  return { repo, queries: list.queries, modifies, reloadPage, ...view };
}

const selectButton = () => screen.getByRole('button', { name: 'Select' });

describe('the add collection dialog of an ansible repository', () => {
  it('lists the collection versions of the server as flat rows without a repository column', async () => {
    setup([row()]);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('ns.col v1.0.0')).toBeTruthy();
    expect(within(dialog).getByText('A test collection')).toBeTruthy();
    expect(
      within(dialog).queryByRole('columnheader', { name: 'Repository' }),
    ).toBeNull();
  });

  it('asks the server only for parameters the endpoint accepts', async () => {
    const { queries } = setup([row()]);

    await screen.findByText('ns.col v1.0.0');

    expect(queries).toHaveLength(1);
    expect(Array.from(queries[0].keys()).sort()).toEqual(['limit', 'offset']);
  });

  it('adds the selected collection version through a modify request and says what was added', async () => {
    const { user, repo, modifies } = setup([row()]);

    await user.click(await screen.findByText('ns.col v1.0.0'));
    await user.click(selectButton());

    await waitFor(() => expect(modifies).toHaveLength(1));
    expect(modifies[0].path).toBe(`${repo.pulp_href}modify/`);
    expect(modifies[0].body).toEqual({ add_content_units: [row().pulp_href] });
    const alerts = within(screen.getByRole('list', { name: 'alerts' }));
    expect(
      await alerts.findByText(
        'Started adding ns.col v1.0.0 to repository "r1".',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('unselects a collection version that is clicked twice', async () => {
    const { user, modifies } = setup([row()]);
    const label = await screen.findByText('ns.col v1.0.0');

    expect(selectButton()).toBeDisabled();
    await user.click(label);
    expect(selectButton()).toBeEnabled();
    await user.click(label);
    expect(selectButton()).toBeDisabled();
    expect(modifies).toEqual([]);
  });

  it('reloads the page once the task of the add is done', async () => {
    const { user, reloadPage } = setup([row()]);

    await user.click(await screen.findByText('ns.col v1.0.0'));
    await user.click(selectButton());

    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
  });

  it('reports a failed task and keeps the page as it is', async () => {
    const { user, reloadPage } = setup([row()], { taskState: 'failed' });

    await user.click(await screen.findByText('ns.col v1.0.0'));
    await user.click(selectButton());

    const alerts = within(screen.getByRole('list', { name: 'alerts' }));
    expect(
      await alerts.findByText('Failed to add collection to repository "r1".'),
    ).toBeTruthy();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('sends one add request when Select is clicked twice', async () => {
    const { user, modifies } = setup([row()], { modifyDelay: 200 });

    await user.click(await screen.findByText('ns.col v1.0.0'));
    const select = selectButton();
    await user.click(select);
    await user.click(select);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(modifies).toHaveLength(1);
  });
});
