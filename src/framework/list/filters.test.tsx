import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { URL_BUDGET } from 'src/entities/batch';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IDistribution,
  type IRemote,
  type IRepository,
  distributionListHandler,
  pluginDistribution,
  pluginListHandler,
  pluginRemote,
  pluginRepository,
  publicationListHandler,
  repositoryVersion,
  taskListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

function serveLab(
  repositories: IRepository[],
  {
    distributions = [],
    remotes = [],
  }: { distributions?: IDistribution[]; remotes?: IRemote[] } = {},
) {
  const lab = {
    repositories: pluginListHandler('file', 'repository', repositories, {
      pageSize: 1000,
    }),
    remotes: pluginListHandler('file', 'remote', remotes, { pageSize: 1000 }),
    distributions: distributionListHandler('file', distributions),
    publications: publicationListHandler('file', []),
    versions: versionSummaryHandler({
      patched: true,
      versions: repositories.map((repository) =>
        repositoryVersion(repository, 0),
      ),
    }),
    tasks: taskListHandler([]),
  };
  server.use(
    lab.repositories.handler,
    lab.remotes.handler,
    ...remotes.map((remote) =>
      http.get(`*${remote.pulp_href}`, () => HttpResponse.json(remote)),
    ),
    lab.distributions.handler,
    lab.publications.handler,
    lab.versions.handler,
    lab.tasks.handler,
  );
  return lab;
}

// The routes are built once, as in the application: routes rebuilt on every
// render would make a new screen of every address change.
const ROUTES = guardRoutes(frameworkRoutes([FILE]));

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      {useRoutes(ROUTES)}
    </>
  );
}

let served: { stop: () => void } | undefined;

beforeEach(() => {
  served = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  served?.stop();
  resetSessionEvents();
});

function renderList(route = '/file/repositories') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const tableOf = () => screen.findByRole('grid', { name: 'Repositories' });

const rowNames = () =>
  Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.querySelector('td a')?.textContent,
  );

const location = () => screen.getByTestId('location').textContent;

const lastQuery = (lab: ReturnType<typeof serveLab>) =>
  lab.repositories.queries.at(-1) as URLSearchParams;

// The labels filter's panel, once opened.
async function openLabelFilter(user: ReturnType<typeof renderList>['user']) {
  await user.click(screen.getByRole('button', { name: /^Labels/ }));
  return screen.findByRole('dialog', { name: 'Filter by labels' });
}

const repositories = () => [
  pluginRepository('file', {
    name: 'docs-site',
    pulp_labels: { team: 'docs', tier: 'alpha' },
  }),
  pluginRepository('file', {
    name: 'docs-api',
    pulp_labels: { team: 'docs', 'app.example-name': 'api' },
  }),
  pluginRepository('file', {
    name: 'tools',
    pulp_labels: { team: 'ops', tier: 'alpha', old: null },
  }),
  pluginRepository('file', { name: 'plain', pulp_labels: {} }),
];

// Repositories that match none of the filters of the tests, to fill pages.
const fillers = (count: number) =>
  Array.from({ length: count }, (_, n) =>
    pluginRepository('file', {
      name: `filler-${String(n).padStart(2, '0')}`,
      pulp_labels: { filler: 'x' },
    }),
  );

describe('Integration: the list filters', { tags: ['integration'] }, () => {
  it('sends the name filter with the page, size and order of the list and shows the matching rows', async () => {
    const lab = serveLab([...repositories(), ...fillers(12)]);
    const { user } = renderList('/file/repositories?page=2&page_size=10');
    await tableOf();

    await user.type(
      screen.getByPlaceholderText(/filter by repository name/i),
      'docs{Enter}',
    );

    await waitFor(() =>
      expect(lastQuery(lab).get('name__icontains')).toBe('docs'),
    );
    const query = lastQuery(lab);
    expect(query.get('limit')).toBe('10');
    expect(query.get('ordering')).toBe('name');
    // the filter starts again from the first page
    expect(query.get('offset')).toBe('0');
    await waitFor(() => expect(rowNames()).toEqual(['docs-api', 'docs-site']));
    expect(location()).toBe(
      '/file/repositories?page_size=10&name__icontains=docs',
    );
  });

  it('shows an applied name filter as a chip that removes it', async () => {
    const lab = serveLab(repositories());
    const { user } = renderList('/file/repositories?name__icontains=docs');
    await tableOf();

    expect(rowNames()).toEqual(['docs-api', 'docs-site']);
    const chip = screen.getByText('docs', { selector: '.pf-v6-c-label__text' });
    await user.click(
      within(chip.closest('.pf-v6-c-label') as HTMLElement).getByRole(
        'button',
        { name: /close/i },
      ),
    );

    await waitFor(() => expect(location()).toBe('/file/repositories'));
    await waitFor(() =>
      expect(lastQuery(lab).has('name__icontains')).toBe(false),
    );
    await waitFor(() => expect(rowNames()).toHaveLength(4));
  });

  it('sends one label expression joined with AND for two key and value rows', async () => {
    const lab = serveLab(repositories());
    const { user } = renderList();
    await tableOf();

    const panel = await openLabelFilter(user);
    await user.type(
      within(panel).getByRole('combobox', { name: 'Label key' }),
      'team',
    );
    await user.type(
      within(panel).getByRole('textbox', { name: 'Label value' }),
      'docs',
    );
    await user.click(
      within(panel).getByRole('button', { name: 'Add label condition' }),
    );
    const keys = within(panel).getAllByRole('combobox', { name: 'Label key' });
    const values = within(panel).getAllByRole('textbox', {
      name: 'Label value',
    });
    await user.type(keys[1] as HTMLElement, 'tier');
    await user.type(values[1] as HTMLElement, 'alpha');
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(lastQuery(lab).get('pulp_label_select')).toBe(
        'team=docs,tier=alpha',
      ),
    );
    expect(
      lab.repositories.queries.filter((q) => q.has('pulp_label_select')),
    ).toHaveLength(1);
    await waitFor(() => expect(rowNames()).toEqual(['docs-site']));
    expect(location()).toBe(
      '/file/repositories?pulp_label_select=team%3Ddocs%2Ctier%3Dalpha',
    );
  });

  it('sends a key with no value as a has-key term and escapes a comma of a value', async () => {
    const lab = serveLab(repositories());
    const { user } = renderList();
    await tableOf();

    const panel = await openLabelFilter(user);
    await user.type(
      within(panel).getByRole('combobox', { name: 'Label key' }),
      'old',
    );
    await user.click(
      within(panel).getByRole('button', { name: 'Add label condition' }),
    );
    const keys = within(panel).getAllByRole('combobox', { name: 'Label key' });
    const values = within(panel).getAllByRole('textbox', {
      name: 'Label value',
    });
    await user.type(keys[1] as HTMLElement, 'note');
    await user.type(values[1] as HTMLElement, 'a,b');
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(lastQuery(lab).get('pulp_label_select')).toBe('old,note=a\\,b'),
    );
  });

  it('sends an expression written in the advanced input unchanged', async () => {
    const lab = serveLab(repositories());
    const { user } = renderList();
    await tableOf();

    const panel = await openLabelFilter(user);
    await user.click(
      within(panel).getByRole('button', { name: 'Write an expression' }),
    );
    await user.type(
      within(panel).getByRole('textbox', { name: 'Label expression' }),
      'team!=docs,!old,tier~alp',
    );
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(lastQuery(lab).get('pulp_label_select')).toBe(
        'team!=docs,!old,tier~alp',
      ),
    );
    await waitFor(() => expect(rowNames()).toEqual([]));
  });

  it('shows the label terms as chips and removes one term at a time', async () => {
    const lab = serveLab(repositories());
    const { user } = renderList(
      '/file/repositories?pulp_label_select=team%3Ddocs%2Ctier%3Dalpha',
    );
    await tableOf();

    expect(rowNames()).toEqual(['docs-site']);
    const chip = screen.getByText('team=docs', {
      selector: '.pf-v6-c-label__text',
    });
    expect(
      screen.getByText('tier=alpha', { selector: '.pf-v6-c-label__text' }),
    ).toBeVisible();
    await user.click(
      within(chip.closest('.pf-v6-c-label') as HTMLElement).getByRole(
        'button',
        { name: /close/i },
      ),
    );

    await waitFor(() =>
      expect(location()).toBe(
        '/file/repositories?pulp_label_select=tier%3Dalpha',
      ),
    );
    await waitFor(() =>
      expect(lastQuery(lab).get('pulp_label_select')).toBe('tier=alpha'),
    );
    await waitFor(() => expect(rowNames()).toEqual(['docs-site', 'tools']));
  });

  it('opens with the key and value rows the address holds', async () => {
    serveLab(repositories());
    const { user } = renderList(
      '/file/repositories?pulp_label_select=team%3Ddocs%2Ctier%3Dalpha',
    );
    await tableOf();

    const panel = await openLabelFilter(user);
    expect(
      within(panel)
        .getAllByRole('combobox', { name: 'Label key' })
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['team', 'tier']);
    expect(
      within(panel)
        .getAllByRole('textbox', { name: 'Label value' })
        .map((input) => (input as HTMLInputElement).value),
    ).toEqual(['docs', 'alpha']);
  });

  it('shows the advanced input for an expression that only text can hold', async () => {
    serveLab(repositories());
    const { user } = renderList(
      '/file/repositories?pulp_label_select=team!%3Ddocs',
    );
    await tableOf();

    const panel = await openLabelFilter(user);
    expect(
      (
        within(panel).getByRole('textbox', {
          name: 'Label expression',
        }) as HTMLInputElement
      ).value,
    ).toBe('team!=docs');
  });

  it('suggests the keys of the labels on the page', async () => {
    serveLab(repositories());
    const { user } = renderList();
    await tableOf();

    await openLabelFilter(user);

    const options = Array.from(
      document.querySelectorAll('datalist option'),
    ).map((option) => option.getAttribute('value'));
    expect(options).toEqual(['app.example-name', 'old', 'team', 'tier']);
  });

  it('holds back a key the server would refuse and says why', async () => {
    const lab = serveLab(repositories());
    const { user } = renderList();
    await tableOf();

    const panel = await openLabelFilter(user);
    await user.type(
      within(panel).getByRole('combobox', { name: 'Label key' }),
      'a,b',
    );

    expect(
      await within(panel).findByText(
        'A key may hold letters, digits, spaces, dots, hyphens and underscores.',
      ),
    ).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(
      lab.repositories.queries.filter((query) =>
        query.has('pulp_label_select'),
      ),
    ).toHaveLength(0);
  });

  it('accepts a key with a dot and a hyphen and a value with a comma', async () => {
    serveLab(repositories());
    const { user } = renderList();
    await tableOf();

    const panel = await openLabelFilter(user);
    await user.type(
      within(panel).getByRole('combobox', { name: 'Label key' }),
      'app.example-name',
    );
    await user.type(
      within(panel).getByRole('textbox', { name: 'Label value' }),
      'x,y',
    );

    expect(within(panel).getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('holds back a value with a parenthesis and says why', async () => {
    serveLab(repositories());
    const { user } = renderList();
    await tableOf();

    const panel = await openLabelFilter(user);
    await user.type(
      within(panel).getByRole('combobox', { name: 'Label key' }),
      'a',
    );
    await user.type(
      within(panel).getByRole('textbox', { name: 'Label value' }),
      'x(y',
    );

    expect(
      await within(panel).findByText('A value may not contain parentheses.'),
    ).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('shows the reason the server gives for a refused expression at the input and keeps the rows of the previous result', async () => {
    const lab = serveLab(repositories());
    const { user } = renderList();
    await tableOf();
    expect(rowNames()).toHaveLength(4);

    const panel = await openLabelFilter(user);
    await user.click(
      within(panel).getByRole('button', { name: 'Write an expression' }),
    );
    await user.type(
      within(panel).getByRole('textbox', { name: 'Label expression' }),
      'team=docs,,tier',
    );
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));

    const reason = await screen.findByText("Invalid search term: ''.");
    await waitFor(() => expect(reason).toBeVisible());
    // the input holds what was typed and the previous rows are still there
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Label expression',
        }) as HTMLInputElement
      ).value,
    ).toBe('team=docs,,tier');
    expect(rowNames()).toHaveLength(4);
    expect(
      screen.queryByText('Repositories could not be displayed.'),
    ).toBeNull();
    expect(lastQuery(lab).get('pulp_label_select')).toBe('team=docs,,tier');
  });

  it('shows no error page when the address itself holds a refused expression', async () => {
    serveLab(repositories());
    renderList('/file/repositories?pulp_label_select=%3Dx');

    const reason = await screen.findByText("Invalid search term: '=x'.");
    await waitFor(() => expect(reason).toBeVisible());
    expect(
      screen.queryByText('Repositories could not be displayed.'),
    ).toBeNull();
    // the filter is still there to be corrected
    expect(screen.getByRole('button', { name: /^Labels/ })).toBeVisible();
  });

  it('keeps the filter bar on screen while another filter loads', async () => {
    serveLab(repositories());
    const { user } = renderList();
    await tableOf();

    await user.type(
      screen.getByPlaceholderText(/filter by repository name/i),
      'tools{Enter}',
    );

    await waitFor(() => expect(rowNames()).toEqual(['tools']));
    expect(screen.getByRole('button', { name: /^Labels/ })).toBeVisible();
  });

  it('starts again from the first page when a label filter is applied', async () => {
    const many = Array.from({ length: 30 }, (_, n) =>
      pluginRepository('file', {
        name: `repo-${String(n).padStart(2, '0')}`,
        pulp_labels: { team: 'a' },
      }),
    );
    const lab = serveLab(many);
    const { user } = renderList('/file/repositories?page=2&page_size=10');
    await tableOf();

    const panel = await openLabelFilter(user);
    await user.type(
      within(panel).getByRole('combobox', { name: 'Label key' }),
      'team',
    );
    await user.click(within(panel).getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(lastQuery(lab).get('pulp_label_select')).toBe('team'),
    );
    expect(lastQuery(lab).get('offset')).toBe('0');
    expect(location()).toBe(
      '/file/repositories?page_size=10&pulp_label_select=team',
    );
  });

  it('clears the label filter from the panel', async () => {
    const lab = serveLab(repositories());
    const { user } = renderList('/file/repositories?pulp_label_select=team');
    await tableOf();

    const panel = await openLabelFilter(user);
    await user.click(within(panel).getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(location()).toBe('/file/repositories'));
    await waitFor(() =>
      expect(lastQuery(lab).has('pulp_label_select')).toBe(false),
    );
  });
});

// The addresses of the requests a list sends to the API, apart from the
// session's own reads.
function recordRequests() {
  const all: string[] = [];
  const onStart = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/pulp/api/v3/')) {
      all.push(`${url.pathname}${url.search}`);
    }
  };
  server.events.on('request:start', onStart);

  return {
    all,
    own: () =>
      all.filter(
        (path) =>
          !/^\/pulp\/api\/v3\/(login|status|users|groups|roles)\//.test(path),
      ),
    stop: () => server.events.removeListener('request:start', onStart),
  };
}

// An address of one object: a repository, distribution, publication, task or
// remote by its id, or one version of a repository.
const SINGLE_OBJECT =
  /\/(repositories|distributions|publications|remotes|tasks)\/[a-z_]+(\/[a-z_]+)?\/[0-9a-f-]{36}\/|\/versions\/\d+\/|my_permissions/;

// Picks a filter in the search box's list of filters.
async function chooseFilter(
  user: ReturnType<typeof renderList>['user'],
  title: string,
) {
  const compound = document.querySelector(
    '[data-cy="compound_filter"]',
  ) as HTMLElement;
  await user.click(within(compound).getAllByRole('button')[0] as HTMLElement);
  await user.click(await screen.findByRole('menuitem', { name: title }));
  return compound;
}

// A repository per distribution, bound to it by the repository field.
function servedBy(count: number, basePath: (n: number) => string) {
  const repositories = Array.from({ length: count }, (_, n) =>
    pluginRepository('file', {
      name: `served-${String(n).padStart(4, '0')}`,
      pulp_labels: { served: 'yes' },
    }),
  );
  const distributions = repositories.map((repository, n) =>
    pluginDistribution('file', {
      base_path: basePath(n),
      repository: repository.pulp_href,
    }),
  );
  return { repositories, distributions };
}

describe(
  'Integration: the remote and base path filters',
  { tags: ['integration'] },
  () => {
    it('offers None and the remotes found by name and sends the one chosen', async () => {
      const remotes = [
        pluginRemote('file', { name: 'alpine-mirror' }),
        pluginRemote('file', { name: 'debian-mirror' }),
      ];
      const [first, second, third] = [
        pluginRepository('file', {
          name: 'a-uses',
          remote: remotes[0]?.pulp_href,
        }),
        pluginRepository('file', {
          name: 'b-uses',
          remote: remotes[1]?.pulp_href,
        }),
        pluginRepository('file', { name: 'c-alone', remote: null }),
      ] as IRepository[];
      const lab = serveLab([first, second, third] as IRepository[], {
        remotes,
      });
      const { user } = renderList();
      await tableOf();

      const compound = await chooseFilter(user, 'Remote');
      const input = within(compound).getByRole('combobox', {
        name: /filter by remote/i,
      });
      await user.click(input);
      expect(await screen.findByRole('option', { name: 'None' })).toBeVisible();
      expect(
        await screen.findByRole('option', { name: 'debian-mirror' }),
      ).toBeVisible();

      await user.type(input, 'alp');
      await waitFor(() =>
        expect(lab.remotes.queries.at(-1)?.get('name__icontains')).toBe('alp'),
      );
      await user.click(
        await screen.findByRole('option', { name: 'alpine-mirror' }),
      );

      await waitFor(() =>
        expect(lastQuery(lab).get('remote')).toBe(remotes[0]?.pulp_href),
      );
      await waitFor(() => expect(rowNames()).toEqual(['a-uses']));
      expect(
        screen.getByText('alpine-mirror', { selector: '.pf-v6-c-label__text' }),
      ).toBeVisible();
      expect(location()).toBe(
        `/file/repositories?remote=${encodeURIComponent(remotes[0]?.pulp_href as string)}`,
      );
    });

    it('sends remote=null for None and shows it as a chip', async () => {
      const remotes = [pluginRemote('file', { name: 'alpine-mirror' })];
      const lab = serveLab(
        [
          pluginRepository('file', {
            name: 'a-uses',
            remote: remotes[0]?.pulp_href,
          }),
          pluginRepository('file', { name: 'c-alone', remote: null }),
        ],
        { remotes },
      );
      const { user } = renderList();
      await tableOf();

      const compound = await chooseFilter(user, 'Remote');
      await user.click(
        within(compound).getByRole('combobox', { name: /filter by remote/i }),
      );
      await user.click(await screen.findByRole('option', { name: 'None' }));

      await waitFor(() => expect(lastQuery(lab).get('remote')).toBe('null'));
      await waitFor(() => expect(rowNames()).toEqual(['c-alone']));
      expect(
        screen.getByText('None', { selector: '.pf-v6-c-label__text' }),
      ).toBeVisible();
      expect(location()).toBe('/file/repositories?remote=null');
    });

    it('names the remote of an address in its chip and ignores a remote that is not a remote address', async () => {
      const remotes = [pluginRemote('file', { name: 'alpine-mirror' })];
      const lab = serveLab(
        [
          pluginRepository('file', {
            name: 'a-uses',
            remote: remotes[0]?.pulp_href,
          }),
        ],
        { remotes },
      );
      renderList(
        `/file/repositories?remote=${encodeURIComponent(remotes[0]?.pulp_href as string)}`,
      );
      await tableOf();
      expect(
        await screen.findByText('alpine-mirror', {
          selector: '.pf-v6-c-label__text',
        }),
      ).toBeVisible();

      expect(lab.repositories.queries.at(-1)?.get('remote')).toBe(
        remotes[0]?.pulp_href,
      );
    });

    it.each([
      'https://elsewhere.example/pulp/api/v3/remotes/file/file/x/',
      '//elsewhere.example/x',
      '/pulp/api/v3/users/1/',
      'not-an-address',
    ])('does not send the remote %j of the address', async (remote) => {
      const lab = serveLab([pluginRepository('file', { name: 'a' })]);
      const log = recordRequests();
      renderList(`/file/repositories?remote=${encodeURIComponent(remote)}`);
      await tableOf();
      log.stop();

      expect(lab.repositories.queries.at(-1)?.has('remote')).toBe(false);
      expect(log.all.some((path) => path.includes('/users/1/'))).toBe(false);
      expect(log.all.some((path) => path.includes('elsewhere'))).toBe(false);
    });

    it('sends the repositories of the matching distributions as one request with the other filters and server paging', async () => {
      const { repositories, distributions } = servedBy(
        12,
        (n) => `team-a/site-${n}`,
      );
      const others = servedBy(8, (n) => `team-b/site-${n}`);
      const lab = serveLab([...repositories, ...others.repositories], {
        distributions: [...distributions, ...others.distributions],
      });
      const log = recordRequests();
      renderList(
        '/file/repositories?base_path=TEAM-A&name__icontains=served&page_size=10&sort=-name',
      );
      const table = await tableOf();
      log.stop();

      const requests = lab.repositories.queries;
      expect(requests).toHaveLength(1);
      const query = requests[0] as URLSearchParams;
      expect((query.get('pulp_href__in') ?? '').split(',').sort()).toEqual(
        repositories.map(({ pulp_href }) => pulp_href).sort(),
      );
      expect(query.get('name__icontains')).toBe('served');
      expect(query.get('limit')).toBe('10');
      expect(query.get('offset')).toBe('0');
      expect(query.get('ordering')).toBe('-name');
      expect(query.has('base_path')).toBe(false);
      expect(table.querySelectorAll('tbody tr')).toHaveLength(10);
      // the distributions were read once, and nothing was read per row
      expect(lab.distributions.queries).toHaveLength(1);
      expect(log.own().some((path) => SINGLE_OBJECT.test(path))).toBe(false);
    });

    it('applies the base path from the search box and starts from the first page', async () => {
      const { repositories, distributions } = servedBy(
        30,
        (n) => `team-a/site-${n}`,
      );
      const lab = serveLab(repositories, { distributions });
      const { user } = renderList('/file/repositories?page=2&page_size=10');
      await tableOf();

      await chooseFilter(user, 'Base path');
      await user.type(
        screen.getByPlaceholderText(/filter by base path/i),
        'site-1{Enter}',
      );

      await waitFor(() =>
        expect(location()).toBe(
          '/file/repositories?page_size=10&base_path=site-1',
        ),
      );
      await waitFor(() =>
        expect(lastQuery(lab).get('pulp_href__in')).toBeTruthy(),
      );
      const sent = (lastQuery(lab).get('pulp_href__in') ?? '').split(',');
      // site-1 and site-10 to site-19
      expect(sent).toHaveLength(11);
      expect(lastQuery(lab).get('offset')).toBe('0');
      expect(
        screen.getByText('site-1', { selector: '.pf-v6-c-label__text' }),
      ).toBeVisible();
    });

    it('reads every chunk of a large match once, merges and sorts them and pages in the browser', async () => {
      const { repositories, distributions } = servedBy(
        120,
        (n) => `big/site-${n}`,
      );
      const lab = serveLab(
        [...repositories, pluginRepository('file', { name: 'unserved' })],
        { distributions },
      );
      const log = recordRequests();
      const { user } = renderList(
        '/file/repositories?base_path=big&page_size=50',
      );
      const table = await tableOf();
      await waitFor(() =>
        expect(table).toHaveAttribute('data-columns-loaded', 'true'),
      );

      const sent = lab.repositories.queries;
      const chunks = sent.map((query) =>
        (query.get('pulp_href__in') ?? '').split(','),
      );
      // every matching repository was asked for once, and no chunk is longer than a request may be
      expect(chunks.flat().sort()).toEqual(
        repositories.map(({ pulp_href }) => pulp_href).sort(),
      );
      expect(sent.length).toBeGreaterThan(1);
      expect(sent.length).toBe(
        Math.ceil(120 / Math.max(...chunks.map((c) => c.length))),
      );
      for (const path of log.all.filter((p) =>
        p.includes('/repositories/file/file/'),
      )) {
        expect(path.length).toBeLessThanOrEqual(URL_BUDGET + 200);
      }
      // the requests are the chunks plus the one read of the distributions
      expect(
        log
          .own()
          .filter((path) =>
            /\/(repositories|distributions)\/file\/file\/\?/.test(path),
          ),
      ).toHaveLength(sent.length + 1);
      expect(
        Array.from(table.querySelectorAll('tbody tr td:first-child a')).map(
          (a) => a.textContent,
        ),
      ).toEqual(repositories.slice(0, 50).map(({ name }) => name));

      // another page and another order are read from the chunks already held
      const before = lab.repositories.queries.length;
      await user.click(
        screen.getAllByRole('button', { name: /next page/i })[0] as HTMLElement,
      );
      await waitFor(() =>
        expect(
          document.querySelector('tbody tr td:first-child a')?.textContent,
        ).toBe(repositories[50]?.name),
      );
      expect(lab.repositories.queries).toHaveLength(before);
      expect(
        screen.queryByText('Many repositories match this base path'),
      ).toBeNull();
      log.stop();
    }, 30_000);

    it('sorts the merged rows by the order of the address', async () => {
      const { repositories, distributions } = servedBy(
        80,
        (n) => `big/site-${n}`,
      );
      const lab = serveLab(repositories, { distributions });
      renderList('/file/repositories?base_path=big&page_size=10&sort=-name');
      const table = await tableOf();

      expect(lab.repositories.queries.length).toBeGreaterThan(1);
      expect(
        Array.from(table.querySelectorAll('tbody tr td:first-child a')).map(
          (a) => a.textContent,
        ),
      ).toEqual(
        repositories
          .map(({ name }) => name)
          .reverse()
          .slice(0, 10),
      );
    });

    it('says so when more than 500 repositories match a base path', async () => {
      const { repositories, distributions } = servedBy(
        520,
        (n) => `huge/site-${n}`,
      );
      serveLab(repositories, { distributions });
      renderList('/file/repositories?base_path=huge&page_size=100');
      await tableOf();

      expect(
        await screen.findByText('Many repositories match this base path'),
      ).toBeVisible();
      expect(document.querySelectorAll('tbody tr')).toHaveLength(100);
    }, 60_000);

    it('sends no repository request when no distribution matches the base path', async () => {
      const { repositories, distributions } = servedBy(
        5,
        (n) => `team-a/site-${n}`,
      );
      const lab = serveLab(repositories, { distributions });
      renderList('/file/repositories?base_path=nothing');

      expect(await screen.findByText('No results found')).toBeVisible();
      expect(lab.repositories.queries).toHaveLength(0);
    });

    it('shows a retryable error when the distributions cannot be read for a base path', async () => {
      const { repositories } = servedBy(3, (n) => `team-a/site-${n}`);
      const lab = serveLab(repositories);
      server.use(
        http.get('*/pulp/api/v3/distributions/file/file/', () =>
          HttpResponse.json({ detail: 'down' }, { status: 500 }),
        ),
      );
      renderList('/file/repositories?base_path=team');

      expect(
        await screen.findByText('Repositories could not be displayed.'),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
      expect(lab.repositories.queries).toHaveLength(0);
    });

    it('suggests the keys of every repository when the label filter opens and reads them once', async () => {
      const many = Array.from({ length: 30 }, (_, n) =>
        pluginRepository('file', {
          name: `repo-${String(n).padStart(2, '0')}`,
          pulp_labels:
            n === 29 ? { 'only.on-last-page': 'x' } : { common: 'x' },
        }),
      );
      const lab = serveLab(many);
      const { user } = renderList('/file/repositories?page_size=10');
      await tableOf();
      const before = lab.repositories.queries.length;
      expect(before).toBe(1);

      await openLabelFilter(user);

      await waitFor(() => {
        const options = Array.from(
          document.querySelectorAll('datalist option'),
        ).map((option) => option.getAttribute('value'));
        expect(options).toEqual(['common', 'only.on-last-page']);
      });
      const index = lab.repositories.queries.slice(before);
      expect(index).toHaveLength(1);
      const fields = (index[0] as URLSearchParams)
        .getAll('fields')
        .flatMap((field) => field.split(','));
      expect(fields.sort()).toEqual([
        'name',
        'pulp_href',
        'pulp_labels',
        'remote',
      ]);
      expect(index[0]?.get('limit')).toBe('1000');
    });
  },
);
