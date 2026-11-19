import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { Paths } from 'src/paths';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { serveSignIn } from 'src/test-utils/sign-in-again';
import AnsibleRepositoryEdit from './edit';

const API = '/pulp/api/v3';
const REPOSITORY_ID = '00000000-0000-4000-8000-0000000000aa';
const REPOSITORY_HREF = `${API}/repositories/ansible/ansible/${REPOSITORY_ID}/`;
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;

interface Seen {
  method: string;
  path: string;
}

let seen: Seen[];
let patched: Record<string, unknown>[];

const writes = () =>
  seen.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);

// Records every request the page makes, in order.
beforeEach(() => {
  seen = [];
  patched = [];
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
  serveSignIn();
  return renderWithProviders(
    <PermissionsKnown>
      <AppContextProvider>
        <Routes>
          <Route
            path={Paths.ansible.repository.edit}
            element={<AnsibleRepositoryEdit />}
          />
          <Route path={Paths.ansible.repository.detail} element={<Where />} />
        </Routes>
      </AppContextProvider>
    </PermissionsKnown>,
    { route },
  );
}

const descriptionInput = () =>
  screen.getByRole('textbox', { name: /Description/ });
const save = () => screen.getByRole('button', { name: 'Save' });

const existing = repository({
  name: 'existing',
  pulp_href: REPOSITORY_HREF,
  description: 'old text',
  retain_repo_versions: 3,
  pulp_labels: { team: 'a' },
  remote: null,
  private: false,
});

describe('editing an ansible repository', () => {
  beforeEach(() => {
    server.use(
      listOf(`${API}/repositories/ansible/ansible/`, [existing], {
        matching: (row, query) => row.name === query.get('name'),
      }).handler,
      listOf(`${API}/remotes/ansible/collection/`, []).handler,
      listOf(`${API}/distributions/ansible/ansible/`, []).handler,
      http.get(`*${API}/repositories/ansible/ansible/:id/my_permissions/`, () =>
        HttpResponse.json({ permissions: [] }),
      ),
      http.patch(
        `*${API}/repositories/ansible/ansible/:id/`,
        async ({ request }) => {
          patched.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
        },
      ),
    );
  });

  it('sends one PATCH with only the changed field and offers no distribution', async () => {
    const { user } = renderEdit('/ansible/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    expect(
      screen.queryByRole('checkbox', { name: /Create a distribution/ }),
    ).toBeNull();
    await user.clear(descriptionInput());
    await user.type(descriptionInput(), 'new text');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/ansible/repositories/detail/existing',
      ),
    );
    expect(writes()).toStrictEqual([
      `PATCH ${API}/repositories/ansible/ansible/${REPOSITORY_ID}/`,
    ]);
    expect(patched).toStrictEqual([{ description: 'new text' }]);
  });

  it('sends no request and says nothing changed when Save is pressed without a change', async () => {
    const { user } = renderEdit('/ansible/repositories/edit/existing');

    await screen.findByDisplayValue('existing');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/ansible/repositories/detail/existing',
      ),
    );
    expect(writes()).toStrictEqual([]);
    expect(
      screen.getByText(/Nothing changed in repository existing/),
    ).toBeInTheDocument();
  });
});

describe('an ansible repository page opened by the address of an object the account cannot read', () => {
  function renderAt(route: string) {
    server.use(
      listOf(`${API}/repositories/ansible/ansible/`, []).handler,
      listOf(`${API}/remotes/ansible/collection/`, []).handler,
      listOf(`${API}/distributions/ansible/ansible/`, []).handler,
    );
    return renderWithProviders(
      <AppContextProvider>
        <Routes>
          <Route
            path={Paths.ansible.repository.edit}
            element={<AnsibleRepositoryEdit />}
          />
        </Routes>
      </AppContextProvider>,
      { route },
    );
  }

  const noForm = () => {
    expect(screen.queryByRole('textbox', { name: /^Name/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByText('Repository could not be displayed.')).toBeNull();
  };

  it.each([
    ['the view permission only', 'ansible.view_ansiblerepository'],
    ['the add permission', 'ansible.add_ansiblerepository'],
  ])(
    'shows the not-found page, no form and no write, to an account that holds %s',
    async (_, permission) => {
      servePermissions({ own: [[permission]] });
      renderAt('/ansible/repositories/edit/hidden');

      expect(
        await screen.findByRole('heading', { name: '404 - Page not found' }),
      ).toBeInTheDocument();
      noForm();
      await new Promise((resolve) => setTimeout(resolve, 150));
      noForm();
      expect(writes()).toStrictEqual([]);
    },
  );

  it('still shows the add form to an account that holds the add permission when the address has no name', async () => {
    servePermissions({ own: [['ansible.add_ansiblerepository']] });
    renderAt('/ansible/repositories/edit/_');

    expect(
      await screen.findByRole('textbox', { name: /^Name/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '404 - Page not found' }),
    ).toBeNull();
  });
});
