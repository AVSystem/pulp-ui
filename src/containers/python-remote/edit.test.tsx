import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { listOf, remote } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import PythonRemoteEdit from './edit';

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;

let bodies: Record<string, unknown>[];

beforeEach(() => {
  bodies = [];
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
        <Route path={Paths.python.remote.edit} element={<PythonRemoteEdit />} />
        <Route path={Paths.python.remote.detail} element={<Where />} />
      </Routes>
    </AppContextProvider>,
    { route },
  );
}

function serveCreate() {
  server.use(
    http.post(`*${API}/remotes/python/python/`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(
        { pulp_href: `${API}/remotes/python/python/1/` },
        { status: 201 },
      );
    }),
  );
}

function serveExisting(existing: ReturnType<typeof remote>) {
  server.use(
    listOf(`${API}/remotes/python/python/`, [existing], {
      matching: (row, query) => row.name === query.get('name'),
    }).handler,
    http.put(`*${API}/remotes/python/python/:id/`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
    }),
  );
}

const policy = () =>
  screen.getByRole('combobox', {
    name: /Download policy/,
  }) as HTMLSelectElement;
const includes = () => screen.getByRole('textbox', { name: /^Includes/ });
const excludes = () => screen.getByRole('textbox', { name: /^Excludes/ });
const save = () => screen.getByRole('button', { name: 'Save' });

async function fillNewRemote(user: ReturnType<typeof renderEdit>['user']) {
  await user.type(
    await screen.findByRole('textbox', { name: /^Name/ }),
    'zz-test-python',
  );
  await user.type(
    screen.getByRole('textbox', { name: /^URL/ }),
    'https://pypi.example/',
  );
}

describe('creating a Python remote', () => {
  it('offers the immediate, on demand and streamed download policies', async () => {
    renderEdit('/python/remotes/edit/_');

    await screen.findByRole('textbox', { name: /^Name/ });
    expect(
      Array.from(policy().options).map((option) => option.value),
    ).toStrictEqual(['immediate', 'on_demand', 'streamed']);
  });

  it('sends the on demand policy when the user never touches the select', async () => {
    serveCreate();
    const { user } = renderEdit('/python/remotes/edit/_');

    await fillNewRemote(user);
    expect(policy().value).toBe('on_demand');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/python/remotes/detail/zz-test-python',
      ),
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      name: 'zz-test-python',
      policy: 'on_demand',
    });
  });

  it('sends the policy the user picked', async () => {
    serveCreate();
    const { user } = renderEdit('/python/remotes/edit/_');

    await fillNewRemote(user);
    await user.selectOptions(policy(), 'streamed');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(bodies[0]).toMatchObject({ policy: 'streamed' });
  });

  it('sends includes and excludes trimmed, without blank lines and in the order typed', async () => {
    serveCreate();
    const { user } = renderEdit('/python/remotes/edit/_');

    await fillNewRemote(user);
    await user.type(includes(), '  django  {Enter}{Enter}requests');
    await user.type(excludes(), 'zz-last{Enter}  aa-first  {Enter}');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(bodies[0]['includes']).toStrictEqual(['django', 'requests']);
    expect(bodies[0]['excludes']).toStrictEqual(['zz-last', 'aa-first']);
  });

  it('leaves repeated entries to the server instead of merging them', async () => {
    serveCreate();
    const { user } = renderEdit('/python/remotes/edit/_');

    await fillNewRemote(user);
    await user.type(includes(), 'django{Enter} django {Enter}django>=4');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(bodies[0]['includes']).toStrictEqual([
      'django',
      'django',
      'django>=4',
    ]);
  });

  it('sends a cleared includes field as an empty list, never a list holding an empty string', async () => {
    serveCreate();
    const { user } = renderEdit('/python/remotes/edit/_');

    await fillNewRemote(user);
    await user.type(includes(), 'django');
    await user.clear(includes());
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(bodies[0]['includes']).toStrictEqual([]);
  });
});

describe('editing a Python remote', () => {
  it('shows the stored policy and sends it back unchanged', async () => {
    serveExisting(
      remote({
        name: 'existing',
        policy: 'immediate',
        includes: ['django'],
        excludes: [],
      }),
    );
    const { user } = renderEdit('/python/remotes/edit/existing');

    await screen.findByDisplayValue('existing');
    expect(policy().value).toBe('immediate');
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/python/remotes/detail/existing',
      ),
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ policy: 'immediate' });
  });

  it('sends a cleared excludes field as an empty list', async () => {
    serveExisting(
      remote({
        name: 'existing',
        policy: 'streamed',
        includes: [],
        excludes: ['django<4'],
      }),
    );
    const { user } = renderEdit('/python/remotes/edit/existing');

    await screen.findByDisplayValue('existing');
    expect(excludes()).toHaveValue('django<4');
    await user.clear(excludes());
    await user.click(save());

    await waitFor(() =>
      expect(screen.getByTestId('where')).toBeInTheDocument(),
    );
    expect(bodies[0]['excludes']).toStrictEqual([]);
    expect(bodies[0]).toMatchObject({ policy: 'streamed' });
  });
});
