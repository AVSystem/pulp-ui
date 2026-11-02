import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { remote } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import RPMRemoteEdit from './edit';

const API = '/pulp/api/v3';

// Shows where the application ended up after a save.
function Where() {
  const { pathname } = useLocation();
  return <p data-testid='where'>{pathname}</p>;
}

function renderEdit(route: string) {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route path={Paths.rpm.remote.edit} element={<RPMRemoteEdit />} />
        <Route path={Paths.rpm.remote.detail} element={<Where />} />
      </Routes>
    </AppContextProvider>,
    { route },
  );
}

const save = () => screen.getByRole('button', { name: 'Save' });

describe('the rpm remote form', () => {
  it('creates a new remote with the on demand policy unless the user picks another', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`*${API}/remotes/rpm/rpm/`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(remote(), { status: 201 });
      }),
    );
    const { user } = renderEdit('/rpm/remotes/edit/_');

    await user.type(
      await screen.findByRole('textbox', { name: /^Name/ }),
      'zz-test-remote',
    );
    await user.type(
      screen.getByRole('textbox', { name: /^URL/ }),
      'https://pulp.example/index/',
    );
    expect(
      screen.getByRole('combobox', { name: /Download policy/ }),
    ).toHaveValue('on_demand');
    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(body).toMatchObject({ name: 'zz-test-remote', policy: 'on_demand' });
  });
});
