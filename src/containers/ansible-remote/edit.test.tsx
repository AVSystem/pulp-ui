import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { listOf, remote } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import AnsibleRemoteEdit from './edit';

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;

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
          path={Paths.ansible.remote.edit}
          element={<AnsibleRemoteEdit />}
        />
        <Route path={Paths.ansible.remote.detail} element={<Where />} />
      </Routes>
    </AppContextProvider>,
    { route },
  );
}

const save = () => screen.getByRole('button', { name: 'Save' });

describe('the ansible remote form', () => {
  it('creates a new remote without a download policy', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`*${API}/remotes/ansible/collection/`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(remote(), { status: 201 });
      }),
    );
    const { user } = renderEdit('/ansible/remotes/edit/_');

    await user.type(
      await screen.findByRole('textbox', { name: /^Name/ }),
      'zz-test-remote',
    );
    await user.type(
      screen.getByRole('textbox', { name: /^URL/ }),
      'https://pulp.example/api/',
    );
    expect(
      screen.queryByRole('combobox', { name: /Download policy/ }),
    ).toBeNull();
    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(body).toMatchObject({ name: 'zz-test-remote' });
    expect(body).not.toHaveProperty('policy');
  });

  it('does not send the stored policy back when an existing remote is saved', async () => {
    const stored = remote({
      name: 'zz-test-remote',
      policy: 'immediate',
      hidden_fields: [
        'client_key',
        'proxy_username',
        'proxy_password',
        'username',
        'password',
        'token',
      ].map((name) => ({ name, is_set: false })),
      pulp_href: `${API}/remotes/ansible/collection/00000000-0000-4000-8000-0000000000a1/`,
    });
    let body: Record<string, unknown> | undefined;
    server.use(
      listOf(`${API}/remotes/ansible/collection/`, [stored]).handler,
      http.get(`*${stored.pulp_href}my_permissions/`, () =>
        HttpResponse.json({ permissions: [] }),
      ),
      http.put(`*${stored.pulp_href}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      }),
    );
    const { user } = renderEdit('/ansible/remotes/edit/zz-test-remote');

    await screen.findByRole('textbox', { name: /^URL/ });
    expect(
      screen.queryByRole('combobox', { name: /Download policy/ }),
    ).toBeNull();
    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(body).toMatchObject({ name: 'zz-test-remote' });
    expect(body).not.toHaveProperty('policy');
  });
});
