import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { PermissionsKnown } from 'src/test-utils/permissions';
import { listOf, remote, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { serveSignIn } from 'src/test-utils/sign-in-again';
import FileRemoteEdit from './edit';

const API = '/pulp/api/v3';

// Shows where the application ended up after a save.
function Where() {
  const { pathname } = useLocation();
  return <p data-testid='where'>{pathname}</p>;
}

function renderEdit(route: string) {
  serveSignIn();
  return renderWithProviders(
    <PermissionsKnown>
      <AppContextProvider>
        <Routes>
          <Route path={Paths.file.remote.edit} element={<FileRemoteEdit />} />
          <Route path={Paths.file.remote.detail} element={<Where />} />
        </Routes>
      </AppContextProvider>
    </PermissionsKnown>,
    { route },
  );
}

const nameInput = () => screen.findByRole('textbox', { name: /Name/ });
const urlInput = () => screen.getByRole('textbox', { name: /URL/ });
const save = () => screen.getByRole('button', { name: 'Save' });

async function fillAndSave(user, name: string, url: string) {
  await user.type(await nameInput(), name);
  await user.type(urlInput(), url);
  await user.click(save());
}

describe('saving a new file remote that the server does not accept', () => {
  it('shows a readable message and keeps the typed values when the request gets no answer', async () => {
    server.use(
      http.post(`*${API}/remotes/file/file/`, () => HttpResponse.error()),
    );
    const { user } = renderEdit('/file/remotes/edit/_');

    await fillAndSave(user, 'tools', 'https://pulp.example/files/');

    expect(await screen.findByText(/Network Error/)).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
    expect(await nameInput()).toHaveValue('tools');
    expect(urlInput()).toHaveValue('https://pulp.example/files/');
    await waitFor(() => expect(save()).toBeEnabled());
  });

  it('shows the server field error under the URL field when it answers 400', async () => {
    server.use(
      http.post(`*${API}/remotes/file/file/`, () =>
        HttpResponse.json({ url: ['Enter a valid URL.'] }, { status: 400 }),
      ),
    );
    const { user } = renderEdit('/file/remotes/edit/_');

    await fillAndSave(user, 'tools', 'https://pulp.example/files/');

    expect(await screen.findByText('Enter a valid URL.')).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
    expect(urlInput()).toHaveValue('https://pulp.example/files/');
  });

  it('shows the three-part refusal when the answer is a 403 without a field', async () => {
    server.use(
      http.post(`*${API}/remotes/file/file/`, () =>
        HttpResponse.json({ detail: 'Not allowed here.' }, { status: 403 }),
      ),
    );
    const { user } = renderEdit('/file/remotes/edit/_');

    await fillAndSave(user, 'tools', 'https://pulp.example/files/');

    const refusal = await screen.findByText(/Not allowed here\./);
    expect(refusal).toHaveTextContent(
      'You do not have permission to do this. Not allowed here. Contact your organization administrator for more information.',
    );
    expect(refusal).toHaveClass('pulp-break-anywhere');
    expect(screen.queryByTestId('where')).toBeNull();
  });
});

describe('download policy of a file remote', () => {
  it('creates a new remote with the on demand policy unless the user picks another', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`*${API}/remotes/file/file/`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(remote(), { status: 201 });
      }),
    );
    const { user } = renderEdit('/file/remotes/edit/_');

    expect(
      await screen.findByRole('combobox', { name: /Download policy/ }),
    ).toHaveValue('on_demand');
    await fillAndSave(user, 'tools', 'https://pulp.example/files/');

    expect(await screen.findByTestId('where')).toBeInTheDocument();
    expect(body).toMatchObject({ name: 'tools', policy: 'on_demand' });
  });

  it('shows the stored policy of an existing remote and sends it back unchanged', async () => {
    const stored = remote({ name: 'tools', policy: 'immediate' });
    let body: Record<string, unknown> | undefined;
    server.use(
      listOf(`${API}/remotes/file/file/`, [stored]).handler,
      http.put(`*${stored.pulp_href}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ task: task().pulp_href }, { status: 202 });
      }),
    );
    const { user } = renderEdit('/file/remotes/edit/tools');

    expect(
      await screen.findByRole('combobox', { name: /Download policy/ }),
    ).toHaveValue('immediate');
    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());

    expect(await screen.findByTestId('where')).toBeInTheDocument();
    expect(body).toMatchObject({ name: 'tools', policy: 'immediate' });
  });
});
