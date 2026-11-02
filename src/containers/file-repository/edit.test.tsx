import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { Paths } from 'src/paths';
import { listOf, repository, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import FileRepositoryEdit from './edit';

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;

interface Seen {
  method: string;
  path: string;
}

let seen: Seen[];
let created: Record<string, unknown>[];

const writes = () => seen.filter((r) => r.method !== 'GET');

// Records every request the page makes, in order.
beforeEach(() => {
  seen = [];
  created = [];
  server.events.on('request:start', ({ request }) => {
    const path = new URL(request.url).pathname;
    seen.push({ method: request.method, path });
  });
});

afterEach(() => {
  server.events.removeAllListeners();
});

// Shows where the application ended up after a save and the alerts it raised.
function Where() {
  const { pathname } = useLocation();
  const { alerts } = useAppContext();
  return (
    <>
      <p data-testid='where'>{pathname}</p>
      <ul>
        {alerts.map(({ title, description }, index) => (
          <li key={index}>
            {title}
            {description}
          </li>
        ))}
      </ul>
    </>
  );
}

function renderEdit(route: string) {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route
          path={Paths.file.repository.edit}
          element={<FileRepositoryEdit />}
        />
        <Route path={Paths.file.repository.detail} element={<Where />} />
      </Routes>
    </AppContextProvider>,
    { route },
  );
}

const nameInput = () => screen.findByRole('textbox', { name: /Name/ });
const retainInput = () => screen.getByRole('spinbutton', { name: /Retained/ });
const descriptionInput = () =>
  screen.getByRole('textbox', { name: /Description/ });
const save = () => screen.getByRole('button', { name: 'Save' });

// Answers a repository create and keeps the JSON body it was sent.
function serveCreate() {
  server.use(
    http.post(`*${API}/repositories/file/file/`, async ({ request }) => {
      created.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(
        { pulp_href: `${API}/repositories/file/file/1/` },
        { status: 201 },
      );
    }),
  );
}

function serveSupportingLists() {
  server.use(
    listOf(`${API}/remotes/file/file/`, []).handler,
    listOf(`${API}/distributions/file/file/`, []).handler,
    listOf(`${API}/publications/file/file/`, []).handler,
  );
}

describe('creating a file repository', () => {
  beforeEach(serveSupportingLists);

  it('starts with an empty retained versions field and saves null, which keeps every version', async () => {
    serveCreate();
    const { user } = renderEdit('/file/repositories/edit/_');

    await user.type(await nameInput(), 'tools');
    expect(retainInput()).toHaveValue(null);
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/file/repositories/detail/tools',
      ),
    );
    const [body] = created;
    expect(body).toMatchObject({ name: 'tools', retain_repo_versions: null });
    expect(body).not.toHaveProperty('distribution');
    expect(writes().map((r) => `${r.method} ${r.path}`)).toStrictEqual([
      `POST ${API}/repositories/file/file/`,
    ]);
  });

  it('sends the number typed into the retained versions field', async () => {
    serveCreate();
    const { user } = renderEdit('/file/repositories/edit/_');

    await user.type(await nameInput(), 'tools');
    await user.type(retainInput(), '1');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(created[0]).toMatchObject({
      retain_repo_versions: '1',
    });
  });

  it('shows the field error and stays on the form when the server refuses 0 retained versions', async () => {
    server.use(
      http.post(`*${API}/repositories/file/file/`, () =>
        HttpResponse.json(
          {
            retain_repo_versions: [
              'Ensure this value is greater than or equal to 1.',
            ],
          },
          { status: 400 },
        ),
      ),
    );
    const { user } = renderEdit('/file/repositories/edit/_');

    await user.type(await nameInput(), 'tools');
    await user.type(retainInput(), '0');
    await user.click(save());

    expect(
      await screen.findByText(/greater than or equal to 1/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it('shows the server message under Name when the name is already taken', async () => {
    server.use(
      http.post(`*${API}/repositories/file/file/`, () =>
        HttpResponse.json(
          { name: ['This field must be unique.'] },
          { status: 400 },
        ),
      ),
    );
    const { user } = renderEdit('/file/repositories/edit/_');

    await user.type(await nameInput(), 'tools');
    await user.click(save());

    expect(
      await screen.findByText('This field must be unique.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it('sends one repository POST for a double click on Save', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.post(`*${API}/repositories/file/file/`, async () => {
        await held;
        return HttpResponse.json(
          { pulp_href: `${API}/repositories/file/file/1/` },
          { status: 201 },
        );
      }),
    );
    const { user } = renderEdit('/file/repositories/edit/_');

    await user.type(await nameInput(), 'tools');
    await user.dblClick(save());
    release();

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(seen.filter((r) => r.method === 'POST')).toHaveLength(1);
  });
});

describe('editing a file repository', () => {
  const REPOSITORY_ID = '00000000-0000-4000-8000-000000000001';
  const existing = repository({
    name: 'existing',
    pulp_href: `${API}/repositories/file/file/${REPOSITORY_ID}/`,
    description: 'old text',
    retain_repo_versions: 3,
    pulp_labels: { team: 'a', tier: 'b' },
    remote: null,
  });
  let patched: Record<string, unknown>[];

  // Serves the repository and records every PATCH body; the answer is a task
  // (changes were made) unless the test gives another one.
  function serveRepository(answer?: () => Response) {
    server.use(
      listOf(`${API}/repositories/file/file/`, [existing], {
        matching: (row, query) => row.name === query.get('name'),
      }).handler,
      http.patch(`*${API}/repositories/file/file/:id/`, async ({ request }) => {
        patched.push((await request.json()) as Record<string, unknown>);
        return (
          answer?.() ?? HttpResponse.json({ task: TASK_HREF }, { status: 202 })
        );
      }),
    );
  }

  beforeEach(() => {
    patched = [];
    serveSupportingLists();
  });

  it('sends one PATCH with only the changed field and creates neither a repository nor a distribution', async () => {
    serveRepository();
    const { user } = renderEdit('/file/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    expect(
      screen.queryByRole('checkbox', { name: /Create a distribution/ }),
    ).toBeNull();
    await user.clear(descriptionInput());
    await user.type(descriptionInput(), 'new text');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/file/repositories/detail/existing',
      ),
    );
    expect(writes().map((r) => `${r.method} ${r.path}`)).toStrictEqual([
      `PATCH ${API}/repositories/file/file/${REPOSITORY_ID}/`,
    ]);
    expect(patched).toStrictEqual([{ description: 'new text' }]);
  });

  it('sends null for a description the user emptied', async () => {
    serveRepository();
    const { user } = renderEdit('/file/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    await user.clear(descriptionInput());
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(patched).toStrictEqual([{ description: null }]);
  });

  it('sends no request and says nothing changed when Save is pressed without a change', async () => {
    serveRepository();
    const { user } = renderEdit('/file/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/file/repositories/detail/existing',
      ),
    );
    expect(writes()).toStrictEqual([]);
    expect(
      screen.getByText(/Nothing changed in repository existing/),
    ).toBeInTheDocument();
  });

  it('sends no request when a typed value equals the stored one', async () => {
    serveRepository();
    const { user } = renderEdit('/file/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    await user.clear(retainInput());
    await user.type(retainInput(), '3');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(writes()).toStrictEqual([]);
  });

  it('shows the task alert with a link to the task when the update is answered with a task', async () => {
    serveRepository();
    const { user } = renderEdit('/file/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    await user.type(descriptionInput(), '!');
    await user.click(save());

    expect(
      await screen.findByText(/Update started for repository existing/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /detail page/ })).toHaveAttribute(
      'href',
      expect.stringContaining('0000000000cc'),
    );
  });

  it('shows a plain success alert when the update is answered with the repository itself', async () => {
    serveRepository(() => HttpResponse.json(existing, { status: 200 }));
    const { user } = renderEdit('/file/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    await user.type(descriptionInput(), '!');
    await user.click(save());

    expect(
      await screen.findByText(/Updated repository existing/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /detail page/ })).toBeNull();
  });
});

describe('creating a file repository with a distribution that takes long', () => {
  beforeEach(() => {
    serveSupportingLists();
    server.use(
      listOf(`${API}/distributions/`, []).handler,
      http.get(`*${API}/status/`, () =>
        HttpResponse.json({
          content_settings: {
            content_origin: 'https://pulp.example',
            content_path_prefix: '/pulp/content/',
          },
        }),
      ),
    );
  });

  it('says the distribution is still being created, with a link to the task, instead of saying it was not created', async () => {
    serveCreate();
    server.use(
      http.post(`*${API}/distributions/file/file/`, () =>
        HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
      ),
      http.get(`*${API}/tasks/:id/`, () =>
        HttpResponse.json(task({ pulp_href: TASK_HREF, state: 'running' })),
      ),
    );
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
    try {
      const { user } = renderEdit('/file/repositories/edit/_');

      await user.type(await nameInput(), 'tools');
      await user.click(
        screen.getByRole('checkbox', { name: /Create a distribution/ }),
      );
      await user.click(save());
      await vi.advanceTimersByTimeAsync(600_000);

      expect(
        await screen.findByText(/distribution "tools" is still being created/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/was not created/)).toBeNull();
      expect(screen.getByRole('link', { name: /detail page/ })).toHaveAttribute(
        'href',
        expect.stringContaining('0000000000cc'),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
