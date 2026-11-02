import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { Paths } from 'src/paths';
import { listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
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
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route
          path={Paths.ansible.repository.edit}
          element={<AnsibleRepositoryEdit />}
        />
        <Route path={Paths.ansible.repository.detail} element={<Where />} />
      </Routes>
    </AppContextProvider>,
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
