import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  distributionListHandler,
  page,
  pluginDistribution,
  pluginListHandler,
  pluginPublication,
  pluginRepository,
  publicationListHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const API = '/pulp/api/v3';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

function Routed() {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
    </>
  );
}

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
});

type Distribution = ReturnType<typeof pluginDistribution>;
type Publication = ReturnType<typeof pluginPublication>;

// A repository of the plugin, the distributions and publications of the
// plugin's lab, and every request the tab sends.
function serveLab({
  name = 'tools',
  repository = pluginRepository('file', { name }),
  distributions = (_repository: string) => [] as Distribution[],
  publications = (_repository: string) => [] as Publication[],
}: {
  name?: string;
  repository?: ReturnType<typeof pluginRepository>;
  distributions?: (repository: string) => Distribution[];
  publications?: (repository: string) => Publication[];
} = {}) {
  const lab = {
    repository,
    repositories: pluginListHandler('file', 'repository', [repository]),
    distributions: distributionListHandler(
      'file',
      distributions(repository.pulp_href),
    ),
    publications: publicationListHandler(
      'file',
      publications(repository.pulp_href),
    ),
  };
  server.use(
    lab.repositories.handler,
    lab.distributions.handler,
    lab.publications.handler,
  );
  return lab;
}

function renderTab(name = 'tools') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    {
      route: `/file/repositories/${encodeURIComponent(name)}/distributions`,
    },
  );
}

const rowOf = async (name: string) =>
  (await screen.findByText(name)).closest('tr') as HTMLElement;

const URL_A = 'https://pulp.example/pulp/content/served/tools/';

describe(
  'Integration: the Distributions tab',
  { tags: ['integration'] },
  () => {
    it('shows the URL the server reports and a command line that ends with that URL plus PULP_MANIFEST', async () => {
      serveLab({
        distributions: (repository) => [
          pluginDistribution('file', {
            name: 'tools-dist',
            base_path: 'tools',
            base_url: URL_A,
            repository,
          }),
        ],
        publications: (repository) => [
          pluginPublication('file', { repository }),
        ],
      });

      renderTab();

      const cells = within(await rowOf('tools-dist'));
      expect(cells.getByText(URL_A)).toBeVisible();
      expect(cells.getByText('tools')).toBeVisible();
      const line = cells.getByText(/PULP_MANIFEST/);
      expect(line.textContent).toBe(
        `pulp file remote create --name 'tools' --url '${URL_A}PULP_MANIFEST'`,
      );
    });

    it('single-quotes the name and the URL so a hostile repository name is pasted as data', async () => {
      const hostile = "a$(id)'b`id`";
      serveLab({
        name: hostile,
        distributions: (repository) => [
          pluginDistribution('file', {
            name: 'tools-dist',
            base_url: URL_A,
            repository,
          }),
        ],
        publications: (repository) => [
          pluginPublication('file', { repository }),
        ],
      });

      renderTab(hostile);

      const line = within(await rowOf('tools-dist')).getByText(/PULP_MANIFEST/);
      expect(line.textContent).toBe(
        `pulp file remote create --name 'a$(id)'\\''b\`id\`' --url '${URL_A}PULP_MANIFEST'`,
      );
    });

    it('quotes a hostile URL as data too', async () => {
      const url = "https://pulp.example/x/'; echo hi; '/";
      serveLab({
        distributions: (repository) => [
          pluginDistribution('file', {
            name: 'tools-dist',
            base_url: url,
            repository,
          }),
        ],
        publications: (repository) => [
          pluginPublication('file', { repository }),
        ],
      });

      renderTab();

      const line = within(await rowOf('tools-dist')).getByText(/PULP_MANIFEST/);
      expect(line.textContent).toBe(
        `pulp file remote create --name 'tools' --url 'https://pulp.example/x/'\\''; echo hi; '\\''/PULP_MANIFEST'`,
      );
    });

    it('shows no command line for a distribution the server gave no URL', async () => {
      serveLab({
        distributions: (repository) => [
          pluginDistribution('file', {
            name: 'no-url',
            base_url: null as unknown as string,
            repository,
          }),
        ],
        publications: (repository) => [
          pluginPublication('file', { repository }),
        ],
      });

      renderTab();

      const row = await rowOf('no-url');
      expect(within(row).queryByText(/PULP_MANIFEST/)).toBeNull();
      expect(within(row).getAllByText('None').length).toBeGreaterThanOrEqual(2);
    });

    it('lists the distributions bound to the repository, to one of its publications and to one of its versions, and no other, each with its own URL', async () => {
      const repository = pluginRepository('file', { name: 'tools' });
      const published = pluginPublication('file', {
        repository: repository.pulp_href,
      });
      serveLab({
        repository,
        distributions: () => [
          pluginDistribution('file', {
            name: 'zz-bound',
            base_url: 'https://pulp.example/served/zz-bound/',
            repository: repository.pulp_href,
          }),
          pluginDistribution('file', {
            name: 'zz-published',
            base_url: 'https://pulp.example/served/zz-published/',
            publication: published.pulp_href,
          }),
          pluginDistribution('file', {
            name: 'zz-versioned',
            base_url: 'https://pulp.example/served/zz-versioned/',
            repository_version: `${repository.pulp_href}versions/0/`,
          }),
          pluginDistribution('file', {
            name: 'zz-foreign',
            repository: pluginRepository('file').pulp_href,
          }),
        ],
        publications: () => [published],
      });

      renderTab();

      for (const name of ['zz-bound', 'zz-published', 'zz-versioned']) {
        const row = await rowOf(name);
        expect(
          within(row).getByText(
            new RegExp(`https://pulp.example/served/${name}/PULP_MANIFEST`),
          ),
        ).toBeVisible();
        expect(within(row).queryByText(/Not served/)).toBeNull();
      }
      expect(screen.queryByText('zz-foreign')).toBeNull();
    });

    it('shows the not served label next to a distribution without a publication', async () => {
      serveLab({
        distributions: (repository) => [
          pluginDistribution('file', { name: 'bare', repository }),
        ],
      });

      renderTab();

      expect(
        within(await rowOf('bare')).getByText(/Not served: no publication/),
      ).toBeVisible();
    });

    it('says no distribution serves the repository when there is none', async () => {
      serveLab();

      renderTab();

      expect(
        await screen.findByText('No distribution serves this repository'),
      ).toBeVisible();
      expect(
        screen.getByText(
          'Clients cannot download its content until a distribution serves it.',
        ),
      ).toBeVisible();
    });

    it('shows a failed read of the distributions as an error with Retry, never as no distribution, and reads again on Retry', async () => {
      const lab = serveLab();
      let answers = 0;
      server.use(
        http.get(`*${API}/distributions/file/file/`, () => {
          answers += 1;
          return answers === 1
            ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
            : HttpResponse.json(
                page([
                  pluginDistribution('file', {
                    name: 'after-retry',
                    repository: lab.repository.pulp_href,
                  }),
                ]),
              );
        }),
      );

      const { user } = renderTab();

      expect(
        await screen.findByText('Distributions could not be displayed.'),
      ).toBeVisible();
      expect(screen.queryByText(/No distribution serves/)).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('after-retry')).toBeVisible();
      expect(answers).toBe(2);
    });

    it('narrows the rows by name and by base path in the browser, without another request, and offers the way out when nothing matches', async () => {
      const lab = serveLab({
        distributions: (repository) => [
          pluginDistribution('file', {
            name: 'alpha-dist',
            base_path: 'one/path',
            repository,
          }),
          pluginDistribution('file', {
            name: 'beta-dist',
            base_path: 'two/path',
            repository,
          }),
        ],
        publications: (repository) => [
          pluginPublication('file', { repository }),
        ],
      });

      const { user } = renderTab();
      await rowOf('alpha-dist');
      const before = lab.distributions.queries.length;

      await user.type(screen.getByRole('textbox'), 'ALPHA{Enter}');
      await waitFor(() => expect(screen.queryByText('beta-dist')).toBeNull());
      expect(screen.getByText('alpha-dist')).toBeVisible();

      await user.click(screen.getByRole('button', { name: /clear all/i }));
      expect(await screen.findByText('beta-dist')).toBeVisible();

      // switch the filter to the base path
      await user.click(screen.getByRole('button', { name: /name/i }));
      await user.click(await screen.findByText('Base path'));
      await user.type(screen.getByRole('textbox'), 'two/{Enter}');
      await waitFor(() => expect(screen.queryByText('alpha-dist')).toBeNull());
      expect(screen.getByText('beta-dist')).toBeVisible();

      await user.clear(screen.getByRole('textbox'));
      await user.type(screen.getByRole('textbox'), 'nothing-like-it{Enter}');
      expect(await screen.findByText('No results found')).toBeVisible();

      expect(lab.distributions.queries).toHaveLength(before);
    });

    it('orders the rows by name and lets the user order them by another column', async () => {
      serveLab({
        distributions: (repository) => [
          pluginDistribution('file', {
            name: 'b-dist',
            base_path: 'a-path',
            repository,
          }),
          pluginDistribution('file', {
            name: 'a-dist',
            base_path: 'b-path',
            repository,
          }),
        ],
        publications: (repository) => [
          pluginPublication('file', { repository }),
        ],
      });

      const { user } = renderTab();
      await rowOf('a-dist');
      const names = () =>
        Array.from(document.querySelectorAll('tbody tr')).map(
          (row) => row.querySelector('td')?.textContent,
        );
      expect(names()).toEqual(['a-dist', 'b-dist']);

      await user.click(
        document.querySelector('[data-cy="sort_base_path"]') as Element,
      );

      await waitFor(() => expect(names()).toEqual(['b-dist', 'a-dist']));
    });

    it('pages ten rows at a time', async () => {
      serveLab({
        distributions: (repository) =>
          Array.from({ length: 25 }, (_, n) =>
            pluginDistribution('file', {
              name: `dist-${String(n).padStart(2, '0')}`,
              repository,
            }),
          ),
        publications: (repository) => [
          pluginPublication('file', { repository }),
        ],
      });

      const { user } = renderTab();
      await rowOf('dist-00');
      expect(document.querySelectorAll('tbody tr')).toHaveLength(10);

      await user.click(
        screen.getAllByRole('button', {
          name: 'Go to next page',
        })[0] as HTMLElement,
      );

      expect(await screen.findByText('dist-10')).toBeVisible();
      expect(screen.queryByText('dist-00')).toBeNull();
    });

    it('sends a number of requests that does not grow with the rows', async () => {
      const lab = serveLab({
        distributions: (repository) =>
          Array.from({ length: 60 }, (_, n) =>
            pluginDistribution('file', {
              name: `dist-${String(n).padStart(2, '0')}`,
              repository,
            }),
          ),
        publications: (repository) => [
          pluginPublication('file', { repository }),
        ],
      });
      const seen: string[] = [];
      server.events.on('request:start', ({ request }) => {
        const url = new URL(request.url);
        if (url.pathname.startsWith(API)) {
          seen.push(url.pathname);
        }
      });

      renderTab();
      await rowOf('dist-00');

      const own = seen.filter(
        (path) =>
          !/^\/pulp\/api\/v3\/(login|status|users|groups|roles)\//.test(path),
      );
      // the repository, the distribution index and the repository's publications
      expect(lab.distributions.queries).toHaveLength(1);
      expect(lab.publications.queries.length).toBeLessThanOrEqual(1);
      expect(own.length).toBeLessThanOrEqual(3);
      expect(own.filter((path) => /\/[0-9a-f-]{36}\/$/.test(path))).toEqual([]);
      server.events.removeAllListeners('request:start');
    });
  },
);
