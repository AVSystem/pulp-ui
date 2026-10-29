import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { listOf, repository } from 'src/test-utils/pulp';
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

// Shows where the application ended up after a save.
function Where() {
  const { pathname } = useLocation();
  return <p data-testid='where'>{pathname}</p>;
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
  beforeEach(serveSupportingLists);

  it('sends one PUT to the repository and creates neither a repository nor a distribution', async () => {
    const existing = repository({
      name: 'existing',
      pulp_href: `${API}/repositories/file/file/00000000-0000-4000-8000-000000000001/`,
      retain_repo_versions: null,
    });
    server.use(
      listOf(`${API}/repositories/file/file/`, [existing], {
        matching: (row, query) => row.name === query.get('name'),
      }).handler,
      http.put(`*${API}/repositories/file/file/:id/`, () =>
        HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
      ),
    );
    const { user } = renderEdit('/file/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    expect(
      screen.queryByRole('checkbox', { name: /Create a distribution/ }),
    ).toBeNull();
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/file/repositories/detail/existing',
      ),
    );
    expect(writes().map((r) => `${r.method} ${r.path}`)).toStrictEqual([
      `PUT ${API}/repositories/file/file/00000000-0000-4000-8000-000000000001/`,
    ]);
  });
});
