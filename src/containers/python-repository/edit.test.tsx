import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { Paths } from 'src/paths';
import { distribution, listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import PythonRepositoryEdit from './edit';

const API = '/pulp/api/v3';
const REPOSITORY_HREF = `${API}/repositories/python/python/00000000-0000-4000-8000-0000000000aa/`;
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;

interface Seen {
  method: string;
  path: string;
}

let seen: Seen[];
let repositoryBodies: Record<string, unknown>[];
let distributionBodies: Record<string, unknown>[];

const requests = () => seen.map((r) => `${r.method} ${r.path}`);
const writes = () =>
  seen.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);

// Records every request the page makes, in order.
beforeEach(() => {
  seen = [];
  repositoryBodies = [];
  distributionBodies = [];
  server.events.on('request:start', ({ request }) => {
    seen.push({ method: request.method, path: new URL(request.url).pathname });
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
        {alerts.map(({ title }, index) => (
          <li key={index}>{String(title)}</li>
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
          path={Paths.python.repository.edit}
          element={<PythonRepositoryEdit />}
        />
        <Route path={Paths.python.repository.detail} element={<Where />} />
      </Routes>
    </AppContextProvider>,
    { route },
  );
}

const nameInput = () => screen.findByRole('textbox', { name: /^Name/ });
const repositoryVersionsInput = () =>
  screen.getByRole('spinbutton', { name: /Retained number of versions/ });
const createDistributionBox = () =>
  screen.getByRole('checkbox', { name: /Create a distribution/ });
const save = () => screen.getByRole('button', { name: 'Save' });

function serveRepositoryCreate() {
  server.use(
    http.post(`*${API}/repositories/python/python/`, async ({ request }) => {
      repositoryBodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ pulp_href: REPOSITORY_HREF }, { status: 201 });
    }),
  );
}

function serveDistributionCreate(answer: () => Response) {
  server.use(
    http.post(`*${API}/distributions/python/pypi/`, async ({ request }) => {
      distributionBodies.push(
        (await request.json()) as Record<string, unknown>,
      );
      return answer();
    }),
    http.get(`*${API}/tasks/:id/`, () =>
      HttpResponse.json({ pulp_href: TASK_HREF, state: 'completed' }),
    ),
  );
}

function serveSupportingLists() {
  server.use(
    listOf(`${API}/remotes/python/python/`, []).handler,
    listOf(`${API}/distributions/python/pypi/`, []).handler,
    // the conflict checks read the generic list of all plugins
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
}

describe('creating a Python repository', () => {
  beforeEach(serveSupportingLists);

  it('keeps all versions and offers the distribution unticked, with no RPM or Ansible only options', async () => {
    renderEdit('/python/repositories/edit/_');

    await nameInput();
    expect(repositoryVersionsInput()).toHaveValue(null);
    expect(createDistributionBox()).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Publish new/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Make private/ })).toBeNull();
  });

  it('sends one repository POST with every version kept and no distribution request when the distribution box stays unticked', async () => {
    serveRepositoryCreate();
    const { user } = renderEdit('/python/repositories/edit/_');

    await user.type(await nameInput(), 'zz-test-python');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/python/repositories/detail/zz-test-python',
      ),
    );
    expect(repositoryBodies).toHaveLength(1);
    expect(repositoryBodies[0]).toMatchObject({
      name: 'zz-test-python',
      retain_repo_versions: null,
    });
    expect(repositoryBodies[0]).not.toHaveProperty('autopublish');
    expect(repositoryBodies[0]).not.toHaveProperty('private');
    expect(writes()).toStrictEqual([`POST ${API}/repositories/python/python/`]);
    // the name and base path are only checked when a distribution is wanted
    expect(requests()).not.toContain(`GET ${API}/distributions/`);
  });

  it('sends the package substitution choices the user made', async () => {
    serveRepositoryCreate();
    const { user } = renderEdit('/python/repositories/edit/_');

    await user.type(await nameInput(), 'zz-test-python');
    await user.click(
      screen.getByRole('checkbox', {
        name: /Allow same-filename packages with different contents/,
      }),
    );
    await user.click(
      screen.getByRole('checkbox', {
        name: /Fail the whole version if any package is rejected/,
      }),
    );
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(repositoryBodies[0]).toMatchObject({
      allow_package_substitution: false,
      error_on_reject: false,
    });
  });

  it('checks the name and base path, then creates the repository, then one distribution with the typed base path', async () => {
    serveRepositoryCreate();
    serveDistributionCreate(() =>
      HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
    );
    const { user } = renderEdit('/python/repositories/edit/_');

    await user.type(await nameInput(), 'zz-test-python');
    await user.click(createDistributionBox());
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Base path/ })).toHaveValue(
        'zz-test-python',
      ),
    );
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/python/repositories/detail/zz-test-python',
      ),
    );
    expect(distributionBodies).toStrictEqual([
      {
        name: 'zz-test-python',
        base_path: 'zz-test-python',
        repository: REPOSITORY_HREF,
      },
    ]);
    expect(writes()).toStrictEqual([
      `POST ${API}/repositories/python/python/`,
      `POST ${API}/distributions/python/pypi/`,
    ]);
    const firstCheck = requests().indexOf(`GET ${API}/distributions/`);
    expect(firstCheck).toBeGreaterThanOrEqual(0);
    expect(firstCheck).toBeLessThan(
      requests().indexOf(`POST ${API}/repositories/python/python/`),
    );
  });

  it('reports a refused distribution once, never retries it under another name, and keeps the repository', async () => {
    serveRepositoryCreate();
    serveDistributionCreate(() =>
      HttpResponse.json(
        { base_path: ['Overlaps with an existing distribution.'] },
        { status: 400 },
      ),
    );
    const { user } = renderEdit('/python/repositories/edit/_');

    await user.type(await nameInput(), 'zz-test-python');
    await user.click(createDistributionBox());
    await user.click(save());

    const where = await screen.findByTestId('where');
    expect(where).toHaveTextContent(
      '/python/repositories/detail/zz-test-python',
    );
    expect(
      await screen.findByText(/was not created.*Overlaps with an existing/),
    ).toBeInTheDocument();
    expect(distributionBodies).toHaveLength(1);
    expect(distributionBodies[0]).toMatchObject({ name: 'zz-test-python' });
    const names = [...repositoryBodies, ...distributionBodies].map(
      (b) => b['name'],
    );
    expect(new Set(names)).toStrictEqual(new Set(['zz-test-python']));
    expect(writes()).toStrictEqual([
      `POST ${API}/repositories/python/python/`,
      `POST ${API}/distributions/python/pypi/`,
    ]);
  });

  it('is blocked before any write when a distribution already uses the name', async () => {
    serveRepositoryCreate();
    server.use(
      listOf(
        `${API}/distributions/`,
        [distribution({ name: 'zz-test-python', base_path: 'elsewhere' })],
        {
          matching: (row, query) =>
            query.has('name') ? row.name === query.get('name') : false,
        },
      ).handler,
    );
    const { user } = renderEdit('/python/repositories/edit/_');

    await user.type(await nameInput(), 'zz-test-python');
    await user.click(createDistributionBox());
    await user.click(save());

    expect(
      await screen.findByText(/A distribution named "zz-test-python" already/),
    ).toBeInTheDocument();
    expect(writes()).toStrictEqual([]);
    expect(screen.queryByTestId('where')).toBeNull();
  });
});

describe('editing a Python repository', () => {
  const existing = repository({
    name: 'existing',
    pulp_href: REPOSITORY_HREF,
    retain_repo_versions: null,
    allow_package_substitution: false,
  });

  beforeEach(() => {
    serveSupportingLists();
    server.use(
      listOf(`${API}/repositories/python/python/`, [existing], {
        matching: (row, query) => row.name === query.get('name'),
      }).handler,
      http.patch(
        `*${API}/repositories/python/python/:id/`,
        async ({ request }) => {
          repositoryBodies.push(
            (await request.json()) as Record<string, unknown>,
          );
          return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
        },
      ),
    );
  });

  const substitution = () =>
    screen.getByRole('checkbox', {
      name: /Allow same-filename packages with different contents/,
    });

  it('sends one PATCH with only the changed field and offers no distribution', async () => {
    const { user } = renderEdit('/python/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    expect(
      screen.queryByRole('checkbox', { name: /Create a distribution/ }),
    ).toBeNull();
    expect(substitution()).not.toBeChecked();
    await user.click(substitution());
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/python/repositories/detail/existing',
      ),
    );
    expect(writes()).toStrictEqual([
      `PATCH ${API}/repositories/python/python/00000000-0000-4000-8000-0000000000aa/`,
    ]);
    expect(repositoryBodies).toStrictEqual([
      { allow_package_substitution: true },
    ]);
    expect(screen.queryByText(/Created distribution/)).toBeNull();
  });

  it('sends no request when nothing was changed', async () => {
    const { user } = renderEdit('/python/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(writes()).toStrictEqual([]);
    expect(
      screen.getByText(/Nothing changed in repository existing/),
    ).toBeInTheDocument();
  });
});
