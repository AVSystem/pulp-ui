import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import {
  listOf,
  repository,
  repositoryVersion,
  task,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { CollectionVersionsTab } from './tab-collection-versions';

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

// Serves the collection versions list, records the modify requests and
// answers the task of a modify as completed after `modifyDelay` milliseconds.
function setup(rows: object[], { modifyDelay = 0 } = {}) {
  const repo = repository({
    name: 'zz-test-repo',
    pulp_href: `${API}/repositories/ansible/ansible/00000000-0000-4000-8000-0000000000a1/`,
  });
  const latest = repositoryVersion(repo, 2);
  const item = { ...repo, latest_version_href: latest.pulp_href };
  const modifies: { path: string; body: unknown }[] = [];
  const alerts: { title: unknown }[] = [];

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
      HttpResponse.json(task({ pulp_href: TASK_HREF })),
    ),
  );
  const reloadPage = vi.fn();

  const view = renderWithProviders(
    <CollectionVersionsTab
      item={item}
      actionContext={{
        addAlert: (alert) => alerts.push(alert),
        hasPermission: () => true,
        query: reloadPage,
        state: { params: {} },
      }}
    />,
  );

  return {
    item,
    latest,
    queries: list.queries,
    modifies,
    alerts,
    reloadPage,
    ...view,
  };
}

describe('the collection versions tab of an ansible repository', () => {
  it('lists the versions of the latest repository version and sends only parameters the endpoint accepts', async () => {
    const { latest, queries } = setup([row()]);

    await screen.findByText('A test collection');

    expect(queries).toHaveLength(1);
    const keys = Array.from(queries[0].keys()).sort();
    expect(keys).toEqual(['limit', 'offset', 'repository_version']);
    expect(queries[0].get('repository_version')).toBe(latest.pulp_href);
  });

  it('shows a flat row as namespace.name vversion with its description', async () => {
    setup([row()]);

    expect(await screen.findByText('ns.col v1.0.0')).toBeTruthy();
    expect(screen.getByText('A test collection')).toBeTruthy();
  });

  it('shows the collection as plain text, not as a link', async () => {
    setup([row()]);

    await screen.findByText('ns.col v1.0.0');
    expect(screen.queryByRole('link', { name: /ns\.col/ })).toBeNull();
  });

  it('filters by namespace with a parameter the endpoint accepts', async () => {
    const { user, queries } = setup([row()]);
    await screen.findByText('ns.col v1.0.0');

    await user.type(screen.getByRole('textbox'), 'ns{Enter}');

    await waitFor(() => expect(queries.length).toBeGreaterThan(1));
    const last = queries[queries.length - 1];
    expect(last.get('namespace')).toBe('ns');
    expect(Array.from(last.keys()).sort()).toEqual([
      'limit',
      'namespace',
      'offset',
      'repository_version',
    ]);
  });

  it('removes a collection version from the repository after confirmation', async () => {
    const { user, item, modifies, alerts, reloadPage } = setup([row()]);
    const created = await screen.findByText('ns.col v1.0.0');
    const tableRow = created.closest('tr') as HTMLElement;

    await user.click(within(tableRow).getByRole('button', { name: 'Actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('ns.col v1.0.0');
    expect(dialog.textContent).toContain('zz-test-repo');
    expect(modifies).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(modifies).toHaveLength(1));
    expect(modifies[0].path).toBe(`${item.pulp_href}modify/`);
    expect(modifies[0].body).toEqual({
      remove_content_units: [row().pulp_href],
    });
    await waitFor(() => expect(alerts).toHaveLength(1));
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
  });

  it('sends one remove request when Remove is clicked twice', async () => {
    const { user, modifies } = setup([row()], { modifyDelay: 200 });
    const created = await screen.findByText('ns.col v1.0.0');
    const tableRow = created.closest('tr') as HTMLElement;

    await user.click(within(tableRow).getByRole('button', { name: 'Actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Remove' });
    await user.click(confirm);
    await user.click(confirm);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(modifies).toHaveLength(1);
  });

  it('still opens the add collection dialog after a removal dialog was cancelled', async () => {
    const { user } = setup([row()]);
    const created = await screen.findByText('ns.col v1.0.0');
    const tableRow = created.closest('tr') as HTMLElement;

    await user.click(within(tableRow).getByRole('button', { name: 'Actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Add collection' }));

    expect(
      await screen.findByRole('dialog', { name: 'Select a collection' }),
    ).toBeTruthy();
  });
});
