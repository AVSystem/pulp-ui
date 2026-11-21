import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { listOf, repository, repositoryVersion } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { RepositoryVersionsTab } from './tab-repository-versions';

const API = '/pulp/api/v3';
const REPOSITORY = `${API}/repositories/ansible/ansible/00000000-0000-4000-8000-0000000000e1/`;

// Shows version 2 of an ansible repository, whose base version is the given
// value.
function showVersion(baseVersion: string | null) {
  const repo = repository({ name: 'zz-test-repo', pulp_href: REPOSITORY });
  const version = repositoryVersion(repo, 2, {
    base_version: baseVersion as never,
  });
  server.use(
    listOf(`${API}/repositories/ansible/ansible/:id/versions/`, [version])
      .handler,
  );

  return renderWithProviders(
    <RepositoryVersionsTab
      item={{ ...repo, latest_version_href: version.pulp_href } as never}
      actionContext={{
        addAlert: () => undefined,
        hasObjectPermission: () => true,
        hasPermission: () => true,
        query: () => undefined,
        state: { params: { repositoryVersion: '2' } },
      }}
    />,
  );
}

describe(
  'Integration: the base version of an ansible repository version',
  { tags: ['integration'] },
  () => {
    it('links to the version the base version address names', async () => {
      showVersion(`${REPOSITORY}versions/1/`);

      const link = await screen.findByRole('link', { name: '1' });

      expect(link.getAttribute('href')).toContain('repositoryVersion=1');
      expect(link.getAttribute('href')).toContain('tab=repository-versions');
    });

    it('links to version 0, which is a version too', async () => {
      showVersion(`${REPOSITORY}versions/0/`);

      const link = await screen.findByRole('link', { name: '0' });

      expect(link.getAttribute('href')).toContain('repositoryVersion=0');
    });

    it.each([
      null,
      `${REPOSITORY}versions/`,
      `${REPOSITORY}versions/x/`,
      `${API}/users/1/`,
    ])('shows None for the base version %j', async (base) => {
      showVersion(base);

      expect(await screen.findByText('Base version')).toBeVisible();
      expect(screen.queryByRole('link', { name: /^\d+$/ })).toBeNull();
      expect(screen.getAllByText('None').length).toBeGreaterThan(0);
    });
  },
);
