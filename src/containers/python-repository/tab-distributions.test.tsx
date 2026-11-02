import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import {
  listOf,
  pythonDistribution,
  remote,
  repository,
  task,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import PythonRepositoryDetail from './detail';

const API = '/pulp/api/v3';
const REPOSITORY_HREF = `${API}/repositories/python/python/00000000-0000-4000-8000-0000000000aa/`;
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;

const index = repository({
  name: 'zz-test-python',
  pulp_href: REPOSITORY_HREF,
  retain_repo_versions: null,
  remote: null,
});

const mirror = remote({
  name: 'zz-mirror',
  pulp_href: `${API}/remotes/python/python/00000000-0000-4000-8000-0000000000d1/`,
});
const other = remote({
  name: 'zz-other',
  pulp_href: `${API}/remotes/python/python/00000000-0000-4000-8000-0000000000d2/`,
});

interface Seen {
  method: string;
  path: string;
}

let seen: Seen[];
let patchBodies: Record<string, unknown>[];

const writes = () =>
  seen.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
const reads = (path: string) =>
  seen.filter((r) => r.method === 'GET' && r.path === path).length;

// Records every request the page makes, in order.
beforeEach(() => {
  seen = [];
  patchBodies = [];
  server.events.on('request:start', ({ request }) => {
    seen.push({ method: request.method, path: new URL(request.url).pathname });
  });
});

afterEach(() => {
  server.events.removeAllListeners();
});

const served = pythonDistribution({
  name: 'zz-served',
  base_path: 'bp-served',
  repository: REPOSITORY_HREF,
  remote: null,
  allow_uploads: true,
});

function serveRepositoryAndDistributions(rows = [served]) {
  server.use(
    listOf(`${API}/repositories/python/python/`, [index], {
      matching: (r, query) => r.name === query.get('name'),
    }).handler,
    listOf(`${API}/distributions/python/pypi/`, rows, {
      matching: (row, query) =>
        query.has('repository')
          ? row.repository === query.get('repository')
          : true,
    }).handler,
    listOf(`${API}/remotes/python/python/`, [mirror, other], {
      matching: (row, query) =>
        !query.has('name__icontains') ||
        row.name.includes(query.get('name__icontains') ?? ''),
    }).handler,
    http.get(`*${mirror.pulp_href}`, () => HttpResponse.json(mirror)),
    http.get(`*${other.pulp_href}`, () => HttpResponse.json(other)),
  );
}

// The distribution as the edit dialog reads it by href.
function serveDistribution(row = served) {
  server.use(http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)));
}

function servePatch(answer: () => Response, row = served) {
  server.use(
    http.patch(`*${row.pulp_href}`, async ({ request }) => {
      patchBodies.push((await request.json()) as Record<string, unknown>);
      return answer();
    }),
    http.get(`*${TASK_HREF}`, () =>
      HttpResponse.json(task({ pulp_href: TASK_HREF })),
    ),
  );
}

function renderTab() {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route
          path={Paths.python.repository.detail}
          element={<PythonRepositoryDetail />}
        />
      </Routes>
    </AppContextProvider>,
    { route: '/python/repositories/detail/zz-test-python?tab=distributions' },
  );
}

async function openEditDialog(user: ReturnType<typeof renderTab>['user']) {
  const row = (await screen.findByText('zz-served')).closest('tr');
  expect(row).not.toBeNull();
  await user.click(
    within(row as HTMLElement).getByRole('button', { name: 'Actions' }),
  );
  await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
  return screen.findByRole('dialog');
}

const uploadsBox = (dialog: HTMLElement) =>
  within(dialog).getByRole('checkbox', { name: /Allow uploads/ });
const saveButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Save' });

async function chooseRemote(
  user: ReturnType<typeof renderTab>['user'],
  dialog: HTMLElement,
  name: string,
) {
  await user.click(within(dialog).getByPlaceholderText('Select a remote'));
  await user.click(await screen.findByRole('option', { name }));
}

describe('Python repository Distributions tab: editing a distribution', () => {
  beforeEach(() => {
    serveRepositoryAndDistributions();
    serveDistribution();
  });

  it('opens a dialog with the distribution current remote and upload permission', async () => {
    const row = pythonDistribution({
      name: 'zz-served',
      base_path: 'bp-served',
      repository: REPOSITORY_HREF,
      remote: mirror.pulp_href,
      allow_uploads: false,
    });
    serveRepositoryAndDistributions([row]);
    serveDistribution(row);
    const { user } = renderTab();

    const dialog = await openEditDialog(user);

    await waitFor(() => expect(uploadsBox(dialog)).not.toBeChecked());
    expect(await within(dialog).findByDisplayValue('zz-mirror')).toBeVisible();
  });

  it('sends only the remote when a remote is chosen', async () => {
    servePatch(() => HttpResponse.json({ task: TASK_HREF }, { status: 202 }));
    const { user } = renderTab();
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

    await chooseRemote(user, dialog, 'zz-other');
    await user.click(saveButton(dialog));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ remote: other.pulp_href });
    expect(writes()).toEqual([`PATCH ${served.pulp_href}`]);
  });

  it('sends only allow_uploads when uploads are switched off', async () => {
    servePatch(() => HttpResponse.json({ task: TASK_HREF }, { status: 202 }));
    const { user } = renderTab();
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

    await user.click(uploadsBox(dialog));
    await user.click(saveButton(dialog));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ allow_uploads: false });
  });

  it('sends remote null when the remote is cleared', async () => {
    const row = pythonDistribution({
      name: 'zz-served',
      base_path: 'bp-served',
      repository: REPOSITORY_HREF,
      remote: mirror.pulp_href,
    });
    serveRepositoryAndDistributions([row]);
    serveDistribution(row);
    servePatch(
      () => HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
      row,
    );
    const { user } = renderTab();
    const dialog = await openEditDialog(user);
    await within(dialog).findByDisplayValue('zz-mirror');

    await user.click(within(dialog).getByRole('button', { name: /Clear all/ }));
    await user.click(saveButton(dialog));

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toEqual({ remote: null });
  });

  it('sends no request when nothing changed', async () => {
    const { user } = renderTab();
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

    await user.click(saveButton(dialog));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toEqual([]);
    expect(
      await screen.findByText(/Nothing changed in distribution zz-served/),
    ).toBeInTheDocument();
  });

  it('waits for the task, then reloads the tab and reports the update', async () => {
    servePatch(() => HttpResponse.json({ task: TASK_HREF }, { status: 202 }));
    const { user } = renderTab();
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());
    const loadsBefore = reads(`${API}/distributions/python/pypi/`);

    await user.click(uploadsBox(dialog));
    await user.click(saveButton(dialog));

    expect(
      await screen.findByText(/Updated distribution zz-served/),
    ).toBeInTheDocument();
    expect(reads(TASK_HREF)).toBeGreaterThanOrEqual(1);
    await waitFor(() =>
      expect(reads(`${API}/distributions/python/pypi/`)).toBeGreaterThan(
        loadsBefore,
      ),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports a plain update when the server answers with the object itself', async () => {
    servePatch(() => HttpResponse.json(served));
    const { user } = renderTab();
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

    await user.click(uploadsBox(dialog));
    await user.click(saveButton(dialog));

    expect(
      await screen.findByText(/Updated distribution zz-served/),
    ).toBeInTheDocument();
    expect(reads(TASK_HREF)).toBe(0);
  });

  it("shows the server's field error in the dialog and keeps it open on a 400", async () => {
    servePatch(() =>
      HttpResponse.json(
        { remote: ['Invalid hyperlink - Object does not exist.'] },
        { status: 400 },
      ),
    );
    const { user } = renderTab();
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

    await chooseRemote(user, dialog, 'zz-other');
    await user.click(saveButton(dialog));

    expect(
      await within(dialog).findByText(/Object does not exist/),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the failure of the task in the dialog', async () => {
    server.use(
      http.patch(`*${served.pulp_href}`, () =>
        HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
      ),
      http.get(`*${TASK_HREF}`, () =>
        HttpResponse.json(
          task({
            pulp_href: TASK_HREF,
            state: 'failed',
            error: { description: 'remote is not a python remote' },
          }),
        ),
      ),
    );
    const { user } = renderTab();
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

    await user.click(uploadsBox(dialog));
    await user.click(saveButton(dialog));

    expect(
      await within(dialog).findByText(/remote is not a python remote/),
    ).toBeInTheDocument();
  });

  it('says the update is still running, with the task link, when the task outlives the wait', async () => {
    server.use(
      http.patch(`*${served.pulp_href}`, () =>
        HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
      ),
      http.get(`*${TASK_HREF}`, () =>
        HttpResponse.json(task({ pulp_href: TASK_HREF, state: 'running' })),
      ),
    );
    const { user } = renderTab();
    const dialog = await openEditDialog(user);
    await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());
    await user.click(uploadsBox(dialog));

    // Only the wait between polls runs on fake time; the user events above
    // and below the wait use real timers.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      fireEvent.click(saveButton(dialog));
      await vi.advanceTimersByTimeAsync(400_000);
    } finally {
      vi.useRealTimers();
    }

    expect(await screen.findByText(/still running/)).toBeInTheDocument();
    expect(screen.queryByText(/Updated distribution/)).toBeNull();
    expect(
      screen.getByRole('link', { name: /detail page/ }),
    ).toBeInTheDocument();
  });

  it('shows the Retry of a failed distributions load and loads the page again', async () => {
    let failing = true;
    server.use(
      http.get(`*${API}/distributions/python/pypi/`, () =>
        failing
          ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
          : HttpResponse.json({
              count: 1,
              next: null,
              previous: null,
              results: [served],
            }),
      ),
    );
    const { user } = renderTab();

    expect(
      await screen.findByText(/Distributions could not be displayed/),
    ).toBeInTheDocument();

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('zz-served')).toBeInTheDocument();
  });
});
