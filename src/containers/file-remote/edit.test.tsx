import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import FileRemoteEdit from './edit';

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
        <Route path={Paths.file.remote.edit} element={<FileRemoteEdit />} />
        <Route path={Paths.file.remote.detail} element={<Where />} />
      </Routes>
    </AppContextProvider>,
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

  it('shows the server detail message when the answer carries no field', async () => {
    server.use(
      http.post(`*${API}/remotes/file/file/`, () =>
        HttpResponse.json({ detail: 'Not allowed here.' }, { status: 403 }),
      ),
    );
    const { user } = renderEdit('/file/remotes/edit/_');

    await fillAndSave(user, 'tools', 'https://pulp.example/files/');

    expect(await screen.findByText('Not allowed here.')).toBeInTheDocument();
  });
});
