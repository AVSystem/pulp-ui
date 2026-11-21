import { screen } from '@testing-library/react';
import { useLocation, useNavigate, useRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { legacyRedirectRoutes } from './legacy-redirects';
import { PLUGIN_MANIFESTS, type PluginManifest } from './manifest';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

const DEB: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'deb',
  ) as PluginManifest),
  onFramework: true,
};

// Where the address bar ends up: the redirect routes of the given plugins, and
// a stand-in for every address they lead to.
function Routed({ manifests = [FILE] }: { manifests?: PluginManifest[] }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const routes = useRoutes([
    ...legacyRedirectRoutes(manifests),
    { path: '*', element: <p>arrived</p> },
  ]);

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      <button type='button' onClick={() => navigate(-1)}>
        Back
      </button>
      <button
        type='button'
        onClick={() => navigate('/file/repositories/detail/r')}
      >
        Follow an old link
      </button>
      {routes}
    </>
  );
}

// Opens the address in a router of its own and reports where it ended up.
async function redirectedFrom(route: string): Promise<string> {
  const { unmount } = renderWithProviders(<Routed />, { route });
  await screen.findByText('arrived');
  const where = screen.getByTestId('location').textContent as string;
  unmount();
  return where;
}

describe(
  'Integration: the addresses of the file screens before the framework',
  { tags: ['integration'] },
  () => {
    it('sends the repository detail, with no tab or the details tab, to the new detail address', async () => {
      expect(await redirectedFrom('/file/repositories/detail/r')).toBe(
        '/file/repositories/r/',
      );
    });

    it('keeps the rest of the query when the details tab is named', async () => {
      expect(
        await redirectedFrom('/file/repositories/detail/r?tab=details&x=1'),
      ).toBe('/file/repositories/r/?x=1');
    });

    it('sends the versions tab to the new versions address', async () => {
      expect(
        await redirectedFrom(
          '/file/repositories/detail/r?tab=repository-versions',
        ),
      ).toBe('/file/repositories/r/versions/');
    });

    it('sends a version to the address of that version and keeps the other parameters', async () => {
      expect(
        await redirectedFrom(
          '/file/repositories/detail/r?tab=repository-versions&repositoryVersion=3&x=1',
        ),
      ).toBe('/file/repositories/r/versions/3/?x=1');
    });

    it('keeps version 0, which is a version too', async () => {
      expect(
        await redirectedFrom(
          '/file/repositories/detail/r?tab=repository-versions&repositoryVersion=0',
        ),
      ).toBe('/file/repositories/r/versions/0/');
    });

    it('sends the distributions tab to the new distributions address', async () => {
      expect(
        await redirectedFrom(
          '/file/repositories/detail/r?tab=distributions&page=2',
        ),
      ).toBe('/file/repositories/r/distributions/?page=2');
    });

    it('sends the repository edit address to the new edit address', async () => {
      expect(await redirectedFrom('/file/repositories/edit/r')).toBe(
        '/file/repositories/r/edit/',
      );
    });

    it('sends the old create address of a repository to the new one', async () => {
      expect(await redirectedFrom('/file/repositories/edit/_')).toBe(
        '/file/repository/new/',
      );
    });

    it('sends the remote detail address to the new detail address', async () => {
      expect(await redirectedFrom('/file/remotes/detail/r')).toBe(
        '/file/remotes/r/',
      );
    });

    it('sends the remote edit address to the new edit address', async () => {
      expect(await redirectedFrom('/file/remotes/edit/r')).toBe(
        '/file/remotes/r/edit/',
      );
    });

    it('sends the old create address of a remote to the new one', async () => {
      expect(await redirectedFrom('/file/remotes/edit/_')).toBe(
        '/file/remote/new/',
      );
    });

    it('keeps the query of the edit and create addresses', async () => {
      expect(await redirectedFrom('/file/repositories/edit/r?x=1')).toBe(
        '/file/repositories/r/edit/?x=1',
      );
      expect(await redirectedFrom('/file/remotes/edit/_?x=1')).toBe(
        '/file/remote/new/?x=1',
      );
    });

    it('moves a name with a slash into one encoded segment', async () => {
      expect(await redirectedFrom('/file/repositories/detail/a%2Fb')).toBe(
        '/file/repositories/a%2Fb/',
      );
      expect(await redirectedFrom('/file/remotes/edit/a%2Fb')).toBe(
        '/file/remotes/a%2Fb/edit/',
      );
    });

    it('replaces the old address in the history, so Back does not return to it', async () => {
      const { user } = renderWithProviders(<Routed />, { route: '/start' });
      await screen.findByText('arrived');

      await user.click(
        screen.getByRole('button', { name: 'Follow an old link' }),
      );
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/file/repositories/r/',
      );

      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/start$/);
    });

    it('builds the target from the route and its parameters only, never from the query', async () => {
      for (const hostile of [
        'tab=repository-versions&repositoryVersion=//evil.example/x',
        'tab=repository-versions&repositoryVersion=1.5',
        'tab=repository-versions&repositoryVersion=-1',
        'tab=//evil.example',
        'tab=..%2F..%2Fstatus',
      ]) {
        const target = await redirectedFrom(
          `/file/repositories/detail/r?${hostile}`,
        );

        expect(target.startsWith('/file/repositories/r/')).toBe(true);
        expect(target).not.toMatch(/^\/\//);
        expect(target).not.toMatch(/^\/file\/repositories\/r\/versions\/[^?]/);
      }
    });

    it('treats a tab it does not know as the details tab', async () => {
      expect(
        await redirectedFrom('/file/repositories/detail/r?tab=nonsense&x=1'),
      ).toBe('/file/repositories/r/?x=1');
    });

    it('builds no redirect for a plugin that is not on the framework', () => {
      expect(legacyRedirectRoutes([])).toEqual([]);
    });

    it('declares the six old addresses of every plugin it is given', () => {
      expect(legacyRedirectRoutes([FILE]).map(({ path }) => path)).toEqual([
        '/file/repositories/detail/:name',
        '/file/repositories/edit/:name',
        '/file/repositories/edit/_',
        '/file/remotes/detail/:name',
        '/file/remotes/edit/:name',
        '/file/remotes/edit/_',
      ]);
    });
  },
);

describe(
  'Integration: the addresses of the deb screens before the framework',
  { tags: ['integration'] },
  () => {
    it('sends every old deb address to its new one, keeping the query that is not a tab', async () => {
      const cases: [string, string][] = [
        ['/deb/repositories/detail/r', '/deb/repositories/r/'],
        [
          '/deb/repositories/detail/r?tab=distributions&page=2',
          '/deb/repositories/r/distributions/?page=2',
        ],
        [
          '/deb/repositories/detail/r?tab=repository-versions&repositoryVersion=2',
          '/deb/repositories/r/versions/2/',
        ],
        ['/deb/repositories/edit/r', '/deb/repositories/r/edit/'],
        ['/deb/repositories/edit/_', '/deb/repository/new/'],
        ['/deb/remotes/detail/r', '/deb/remotes/r/'],
        ['/deb/remotes/edit/r', '/deb/remotes/r/edit/'],
        ['/deb/remotes/edit/_', '/deb/remote/new/'],
      ];

      for (const [from, to] of cases) {
        const { unmount } = renderWithProviders(
          <Routed manifests={[DEB]} />,
          { route: from },
        );
        await screen.findByText('arrived');
        expect(screen.getByTestId('location')).toHaveTextContent(
          new RegExp(`^${to.replace(/[?.]/g, '\\$&')}$`),
        );
        unmount();
      }
    });

    it('leaves the old addresses of the plugins that are not on the framework alone', async () => {
      renderWithProviders(<Routed manifests={[DEB]} />, {
        route: '/rpm/repositories/detail/r',
      });
      await screen.findByText('arrived');

      expect(screen.getByTestId('location')).toHaveTextContent(
        /^\/rpm\/repositories\/detail\/r$/,
      );
    });
  },
);
