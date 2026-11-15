import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { serveMyPermissions } from 'src/test-utils/permissions';
import { listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import DebRepositoryList from './list';

const API = '/pulp/api/v3';
const ID = (n: number) => `00000000-0000-4000-8000-0000000000d${n}`;

const owned = repository({
  name: 'owned-repo',
  pulp_href: `${API}/repositories/deb/apt/${ID(1)}/`,
});
const other = repository({
  name: 'other-repo',
  pulp_href: `${API}/repositories/deb/apt/${ID(2)}/`,
});

const OWNER = [
  'deb.change_aptrepository',
  'deb.sync_aptrepository',
  'deb.delete_aptrepository',
];

let recorder: { stop: () => void } | undefined;

afterEach(() => {
  recorder?.stop();
  recorder = undefined;
});

function renderList() {
  server.use(
    listOf(`${API}/repositories/deb/apt/`, [owned, other]).handler,
    listOf(`${API}/remotes/deb/apt/`, []).handler,
  );

  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routes>
          <Route
            path={Paths.deb.repository.list}
            element={<DebRepositoryList />}
          />
        </Routes>
      </PermissionsKnown>
    </AppContextProvider>,
    { route: '/deb/repositories' },
  );
}

const rowOf = (name: string) => screen.getByText(name).closest('tr');

describe('the deb repository list', () => {
  it('shows a viewer neither row actions nor the add button', async () => {
    recorder = servePermissions({ own: [['deb.view_aptrepository']] });
    serveMyPermissions({
      [owned.pulp_href]: ['deb.view_aptrepository'],
      [other.pulp_href]: ['deb.view_aptrepository'],
    });
    renderList();

    await screen.findByText('owned-repo');

    expect(screen.queryByRole('button', { name: 'Add repository' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
  });

  it('shows the actions on the repository whose own permissions list them, and only there', async () => {
    recorder = servePermissions({ own: [['deb.view_aptrepository']] });
    const { requests } = serveMyPermissions({
      [owned.pulp_href]: OWNER,
      [other.pulp_href]: ['deb.view_aptrepository'],
    });
    const { user } = renderList();

    await screen.findByText('owned-repo');
    const kebab = await within(rowOf('owned-repo')).findByRole('button', {
      name: 'Actions',
    });

    await user.click(kebab);
    expect(
      await screen.findByRole('menuitem', { name: 'Edit' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Delete' }),
    ).toBeInTheDocument();
    expect(
      within(rowOf('other-repo')).queryByRole('button', { name: 'Actions' }),
    ).toBeNull();
    expect(requests).toHaveLength(2);
  });

  it('reads no object permissions for a holder of the permissions on every object', async () => {
    recorder = servePermissions({
      own: [
        [
          'deb.add_aptrepository',
          'deb.change_aptrepository',
          'deb.sync_aptrepository',
          'deb.delete_aptrepository',
        ],
      ],
    });
    const { requests } = serveMyPermissions({});
    renderList();

    await screen.findByRole('button', { name: 'Add repository' });
    await within(rowOf('other-repo')).findByRole('button', { name: 'Actions' });

    expect(requests).toHaveLength(0);
  });
});
