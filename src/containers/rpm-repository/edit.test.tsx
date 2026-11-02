import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { Paths } from 'src/paths';
import { distribution, listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import RPMRepositoryEdit from './edit';

const API = '/pulp/api/v3';
const REPOSITORY_HREF = `${API}/repositories/rpm/rpm/00000000-0000-4000-8000-0000000000aa/`;
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
          path={Paths.rpm.repository.edit}
          element={<RPMRepositoryEdit />}
        />
        <Route path={Paths.rpm.repository.detail} element={<Where />} />
      </Routes>
    </AppContextProvider>,
    { route },
  );
}

const nameInput = () => screen.findByRole('textbox', { name: /^Name/ });
const packageVersionsInput = () =>
  screen.getByRole('spinbutton', { name: /Versions kept per package/ });
const repositoryVersionsInput = () =>
  screen.getByRole('spinbutton', { name: /Retained number of versions/ });
const autopublish = () => screen.getByRole('checkbox', { name: /Publish new/ });
const createDistributionBox = () =>
  screen.getByRole('checkbox', { name: /Create a distribution/ });
const save = () => screen.getByRole('button', { name: 'Save' });

function serveRepositoryCreate() {
  server.use(
    http.post(`*${API}/repositories/rpm/rpm/`, async ({ request }) => {
      repositoryBodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ pulp_href: REPOSITORY_HREF }, { status: 201 });
    }),
  );
}

function serveDistributionCreate(answer: () => Response) {
  server.use(
    http.post(`*${API}/distributions/rpm/rpm/`, async ({ request }) => {
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
    listOf(`${API}/remotes/rpm/rpm/`, []).handler,
    listOf(`${API}/distributions/rpm/rpm/`, []).handler,
    listOf(`${API}/publications/rpm/rpm/`, []).handler,
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

describe('creating an RPM repository', () => {
  beforeEach(serveSupportingLists);

  it('offers autopublish unticked and says what ticking it does', async () => {
    renderEdit('/rpm/repositories/edit/_');

    await nameInput();
    expect(autopublish()).not.toBeChecked();
    expect(
      screen.getByText(/publishes every new version/i),
    ).toBeInTheDocument();
    expect(createDistributionBox()).not.toBeChecked();
  });

  it('sends one repository POST and no distribution request when the distribution box stays unticked', async () => {
    serveRepositoryCreate();
    const { user } = renderEdit('/rpm/repositories/edit/_');

    await user.type(await nameInput(), 'zz-test-rpm');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/rpm/repositories/detail/zz-test-rpm',
      ),
    );
    expect(repositoryBodies).toHaveLength(1);
    expect(repositoryBodies[0]).toMatchObject({
      name: 'zz-test-rpm',
      autopublish: false,
      retain_repo_versions: null,
      retain_package_versions: 0,
    });
    expect(writes()).toStrictEqual([`POST ${API}/repositories/rpm/rpm/`]);
    // the name and base path are only checked when a distribution is wanted
    expect(requests()).not.toContain(`GET ${API}/distributions/`);
  });

  it('sends the autopublish choice the user made', async () => {
    serveRepositoryCreate();
    const { user } = renderEdit('/rpm/repositories/edit/_');

    await user.type(await nameInput(), 'zz-test-rpm');
    await user.click(autopublish());
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(repositoryBodies[0]).toMatchObject({ autopublish: true });
  });

  it('sends 0 for a blank package versions field and the number typed otherwise', async () => {
    serveRepositoryCreate();
    const first = renderEdit('/rpm/repositories/edit/_');

    await first.user.type(await nameInput(), 'zz-test-rpm');
    expect(packageVersionsInput()).toHaveValue(null);
    expect(repositoryVersionsInput()).toHaveValue(null);
    await first.user.click(save());
    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    first.unmount();

    const second = renderEdit('/rpm/repositories/edit/_');
    await second.user.type(await nameInput(), 'zz-test-rpm');
    await second.user.type(packageVersionsInput(), '3');
    await second.user.click(save());
    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );

    expect(repositoryBodies.map((b) => b['retain_package_versions'])).toEqual([
      0, 3,
    ]);
  });

  it('checks the name and base path, then creates the repository, then one distribution with the typed base path', async () => {
    serveRepositoryCreate();
    serveDistributionCreate(() =>
      HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
    );
    const { user } = renderEdit('/rpm/repositories/edit/_');

    await user.type(await nameInput(), 'zz-test-rpm');
    await user.click(createDistributionBox());
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Base path/ })).toHaveValue(
        'zz-test-rpm',
      ),
    );
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/rpm/repositories/detail/zz-test-rpm',
      ),
    );
    expect(distributionBodies).toStrictEqual([
      {
        name: 'zz-test-rpm',
        base_path: 'zz-test-rpm',
        repository: REPOSITORY_HREF,
      },
    ]);
    const posted = writes();
    expect(posted).toStrictEqual([
      `POST ${API}/repositories/rpm/rpm/`,
      `POST ${API}/distributions/rpm/rpm/`,
    ]);
    const firstCheck = requests().indexOf(`GET ${API}/distributions/`);
    expect(firstCheck).toBeGreaterThanOrEqual(0);
    expect(firstCheck).toBeLessThan(
      requests().indexOf(`POST ${API}/repositories/rpm/rpm/`),
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
    const { user } = renderEdit('/rpm/repositories/edit/_');

    await user.type(await nameInput(), 'zz-test-rpm');
    await user.click(createDistributionBox());
    await user.click(save());

    const where = await screen.findByTestId('where');
    expect(where).toHaveTextContent('/rpm/repositories/detail/zz-test-rpm');
    expect(
      await screen.findByText(/was not created.*Overlaps with an existing/),
    ).toBeInTheDocument();
    expect(distributionBodies).toHaveLength(1);
    expect(distributionBodies[0]).toMatchObject({ name: 'zz-test-rpm' });
    const names = [...repositoryBodies, ...distributionBodies].map(
      (b) => b['name'],
    );
    expect(new Set(names)).toStrictEqual(new Set(['zz-test-rpm']));
    expect(writes()).toStrictEqual([
      `POST ${API}/repositories/rpm/rpm/`,
      `POST ${API}/distributions/rpm/rpm/`,
    ]);
  });

  it('is blocked before any write when a distribution already uses the name', async () => {
    serveRepositoryCreate();
    server.use(
      listOf(
        `${API}/distributions/`,
        [distribution({ name: 'zz-test-rpm', base_path: 'elsewhere' })],
        {
          matching: (row, query) =>
            query.has('name') ? row.name === query.get('name') : false,
        },
      ).handler,
    );
    const { user } = renderEdit('/rpm/repositories/edit/_');

    await user.type(await nameInput(), 'zz-test-rpm');
    await user.click(createDistributionBox());
    await user.click(save());

    expect(
      await screen.findByText(/A distribution named "zz-test-rpm" already/),
    ).toBeInTheDocument();
    expect(writes()).toStrictEqual([]);
    expect(screen.queryByTestId('where')).toBeNull();
  });
});

describe('editing an RPM repository', () => {
  const existing = repository({
    name: 'existing',
    pulp_href: REPOSITORY_HREF,
    retain_repo_versions: null,
    retain_package_versions: 2,
    autopublish: true,
  });

  beforeEach(() => {
    serveSupportingLists();
    server.use(
      listOf(`${API}/repositories/rpm/rpm/`, [existing], {
        matching: (row, query) => row.name === query.get('name'),
      }).handler,
      http.patch(`*${API}/repositories/rpm/rpm/:id/`, async ({ request }) => {
        repositoryBodies.push(
          (await request.json()) as Record<string, unknown>,
        );
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      }),
    );
  });

  it('sends one PATCH with only the changed field and offers no distribution', async () => {
    const { user } = renderEdit('/rpm/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    expect(
      screen.queryByRole('checkbox', { name: /Create a distribution/ }),
    ).toBeNull();
    expect(autopublish()).toBeChecked();
    expect(packageVersionsInput()).toHaveValue(2);
    await user.click(autopublish());
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/rpm/repositories/detail/existing',
      ),
    );
    expect(writes()).toStrictEqual([
      `PATCH ${API}/repositories/rpm/rpm/00000000-0000-4000-8000-0000000000aa/`,
    ]);
    expect(repositoryBodies).toStrictEqual([{ autopublish: false }]);
    expect(screen.queryByText(/Created distribution/)).toBeNull();
  });

  it('sends 0 when the package versions field was emptied, because the server has no null for it', async () => {
    const { user } = renderEdit('/rpm/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    await user.clear(packageVersionsInput());
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(repositoryBodies).toStrictEqual([{ retain_package_versions: 0 }]);
  });

  it('sends no request when nothing was changed', async () => {
    const { user } = renderEdit('/rpm/repositories/edit/existing');

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
