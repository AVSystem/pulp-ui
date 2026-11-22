import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IDistribution,
  type TestDistributionPlugin,
  artifactDistribution,
  contentGuardListHandler,
  coreDistributionListHandler,
  coreDistributionRow,
  distributionListHandler,
  page,
  pluginDistribution,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { frameworkCoreRoutes } from '../routes';

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      {useRoutes(guardRoutes(frameworkCoreRoutes()))}
    </>
  );
}

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
  resetSessionEvents();
});

function renderList(route = '/distributions') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const ALL_PLUGINS = [
  'core',
  'file',
  'deb',
  'rpm',
  'python',
  'maven',
  'npm',
  'ansible',
  'container',
];

const reportPlugins = (components: string[] = ALL_PLUGINS) =>
  server.use(
    http.get('*/pulp/api/v3/status/', () =>
      HttpResponse.json({
        versions: components.map((component) => ({
          component,
          version: '3.0.0',
        })),
      }),
    ),
  );

const EVERY_PLUGIN: TestDistributionPlugin[] = [
  'file',
  'deb',
  'rpm',
  'python',
  'maven',
  'npm',
  'ansible',
  'container',
];

// A lab: the rows of every plugin, answered by the cross-plugin list and by
// each plugin's own list, the way the server answers them. A plugin with no
// rows answers an empty list.
function serveLab(
  rows: Partial<Record<TestDistributionPlugin, IDistribution[]>>,
) {
  const own = EVERY_PLUGIN.map((plugin) =>
    distributionListHandler(plugin, rows[plugin] ?? []),
  );
  const core = coreDistributionListHandler([
    ...Object.values(rows)
      .flatMap((list) => list ?? [])
      .map(coreDistributionRow),
    artifactDistribution(),
  ]);
  server.use(
    core.handler,
    ...own.map(({ handler }) => handler),
    contentGuardListHandler([]).handler,
  );

  return {
    core,
    // the reads of each plugin's own list, by plugin
    own: Object.fromEntries(
      EVERY_PLUGIN.map((plugin, at) => [plugin, own[at]]),
    ) as Record<TestDistributionPlugin, (typeof own)[number]>,
  };
}

const some = (
  plugin: TestDistributionPlugin,
  name: string,
  overrides: Partial<IDistribution> = {},
) =>
  pluginDistribution(plugin, {
    name,
    base_path: overrides.base_path ?? name,
    ...overrides,
  });

const tableOf = () => screen.findByRole('grid', { name: 'Distributions' });

const rowNames = () =>
  Array.from(document.querySelectorAll('tbody tr')).map(
    (row) => row.querySelector('td')?.textContent,
  );

const location = () => screen.getByTestId('location').textContent;

const lastQuery = (lab: ReturnType<typeof serveLab>) =>
  lab.core.queries.at(-1) as URLSearchParams;

// The filter bar's choice of what to filter by, and the choice made.
async function chooseFilter(
  user: ReturnType<typeof renderList>['user'],
  title: string,
) {
  const bar = document.querySelector('[data-cy="compound_filter"]');
  await user.click(
    within(bar as HTMLElement).getAllByRole('button')[0] as HTMLElement,
  );
  await user.click(await screen.findByRole('menuitem', { name: title }));
}

describe(
  'Integration: filtering the list of every distribution',
  { tags: ['integration'] },
  () => {
    it('sends only the types of the installed plugins when no plugin is chosen', async () => {
      reportPlugins();
      const lab = serveLab({ file: [some('file', 'a')] });

      renderList();
      await tableOf();

      expect(lastQuery(lab).get('pulp_type__in')).toBe(
        [
          'file.file',
          'deb.apt-distribution',
          'rpm.rpm',
          'python.python',
          'maven.maven',
          'npm.npm',
          'ansible.ansible',
          'container.container',
        ].join(','),
      );
    });

    it('sends exactly the two types of the plugins rpm and deb that the address names', async () => {
      reportPlugins();
      const lab = serveLab({
        file: [some('file', 'a-file')],
        rpm: [some('rpm', 'a-rpm')],
        deb: [some('deb', 'a-deb')],
      });

      renderList('/distributions?plugin=rpm%2Cdeb');
      await tableOf();

      expect(lastQuery(lab).get('pulp_type__in')).toBe(
        'deb.apt-distribution,rpm.rpm',
      );
      expect(rowNames()).toEqual(['a-deb', 'a-rpm']);
    });

    it('chooses plugins in the filter bar, puts them in the address, and sends every installed type again when the choice is cleared', async () => {
      reportPlugins(['core', 'file', 'deb', 'rpm']);
      const lab = serveLab({
        file: [some('file', 'a-file')],
        rpm: [some('rpm', 'a-rpm')],
        deb: [some('deb', 'a-deb')],
      });

      const { user } = renderList();
      await tableOf();
      await chooseFilter(user, 'Plugin');
      await user.click(
        screen.getByRole('button', { name: /filter by plugin/i }),
      );
      await user.click(await screen.findByRole('checkbox', { name: 'RPM' }));
      await user.click(screen.getByRole('checkbox', { name: 'deb' }));

      await waitFor(() =>
        expect(lastQuery(lab).get('pulp_type__in')).toBe(
          'deb.apt-distribution,rpm.rpm',
        ),
      );
      expect(location()).toBe('/distributions?plugin=deb%2Crpm');
      await waitFor(() => expect(rowNames()).toEqual(['a-deb', 'a-rpm']));

      // one chip per chosen plugin, each removes that plugin only
      const chips = Array.from(
        document.querySelectorAll('.pf-v6-c-label-group .pf-v6-c-label__text'),
      ).map((chip) => chip.textContent);
      expect(chips).toEqual(['deb', 'RPM']);
      await user.click(
        screen.getByRole('button', { name: 'Clear all filters' }),
      );

      // every installed type is asked for again: the rows of all three show
      await waitFor(() =>
        expect(rowNames()).toEqual(['a-deb', 'a-file', 'a-rpm']),
      );
      expect(location()).toBe('/distributions');
    });

    it('ignores a plugin the address names that is not installed or has no distributions', async () => {
      reportPlugins(['core', 'file', 'rpm']);
      const lab = serveLab({ file: [some('file', 'a-file')] });

      renderList('/distributions?plugin=zzz%2Cdeb');
      await tableOf();

      expect(lastQuery(lab).get('pulp_type__in')).toBe('file.file,rpm.rpm');
      expect(screen.queryByText('zzz')).not.toBeInTheDocument();
    });

    it('sends a name filter as name__icontains and keeps it in the address', async () => {
      const lab = serveLab({
        file: [some('file', 'manuals'), some('file', 'images')],
      });

      const { user } = renderList();
      await tableOf();
      await user.type(
        screen.getByPlaceholderText(/filter by name/i),
        'manu{Enter}',
      );

      await waitFor(() =>
        expect(lastQuery(lab).get('name__icontains')).toBe('manu'),
      );
      expect(location()).toBe('/distributions?name__icontains=manu');
      await waitFor(() => expect(rowNames()).toEqual(['manuals']));
    });

    it('sends a base path filter as base_path__icontains and keeps it in the address', async () => {
      const lab = serveLab({
        file: [
          some('file', 'one', { base_path: 'docs/manuals' }),
          some('file', 'two', { base_path: 'images' }),
        ],
      });

      const { user } = renderList();
      await tableOf();
      await chooseFilter(user, 'Base path');
      await user.type(
        screen.getByPlaceholderText(/filter by base path/i),
        'Manuals{Enter}',
      );

      await waitFor(() =>
        expect(lastQuery(lab).get('base_path__icontains')).toBe('Manuals'),
      );
      expect(location()).toBe('/distributions?base_path__icontains=Manuals');
      await waitFor(() => expect(rowNames()).toEqual(['one']));
    });

    it('combines the plugin, name, base path and label filters in one request', async () => {
      reportPlugins();
      const lab = serveLab({
        file: [
          some('file', 'docs', { pulp_labels: { team: 'a' } }),
          some('file', 'docs-b', { pulp_labels: { team: 'b' } }),
        ],
        rpm: [some('rpm', 'docs-rpm', { pulp_labels: { team: 'a' } })],
      });

      renderList(
        '/distributions?plugin=file&name__icontains=docs&base_path__icontains=doc&pulp_label_select=team%3Da',
      );
      await tableOf();

      const query = lastQuery(lab);
      expect(query.get('pulp_type__in')).toBe('file.file');
      expect(query.get('name__icontains')).toBe('docs');
      expect(query.get('base_path__icontains')).toBe('doc');
      expect(query.get('pulp_label_select')).toBe('team=a');
      expect(rowNames()).toEqual(['docs']);
    });

    it('sends a label filter with the expression the label panel writes, a comma of a value escaped', async () => {
      const lab = serveLab({
        file: [some('file', 'a', { pulp_labels: { note: 'x,y' } })],
      });

      const { user } = renderList();
      await tableOf();
      await user.click(screen.getByRole('button', { name: /^Labels/ }));
      const panel = await screen.findByRole('dialog', {
        name: 'Filter by labels',
      });
      await user.type(
        within(panel).getByRole('combobox', { name: 'Label key' }),
        'note',
      );
      await user.type(
        within(panel).getByRole('textbox', { name: 'Label value' }),
        'x,y',
      );
      await user.click(within(panel).getByRole('button', { name: 'Apply' }));

      await waitFor(() =>
        expect(lastQuery(lab).get('pulp_label_select')).toBe('note=x\\,y'),
      );
      await waitFor(() => expect(rowNames()).toEqual(['a']));
    });

    it('offers the label keys of the rows shown', async () => {
      serveLab({
        file: [
          some('file', 'a', { pulp_labels: { team: 'a', tier: 'x' } }),
          some('file', 'b', { pulp_labels: { owner: 'o' } }),
        ],
      });

      const { user } = renderList();
      await tableOf();
      await user.click(screen.getByRole('button', { name: /^Labels/ }));
      await screen.findByRole('dialog', { name: 'Filter by labels' });

      expect(
        Array.from(document.querySelectorAll('datalist option')).map((option) =>
          option.getAttribute('value'),
        ),
      ).toEqual(['owner', 'team', 'tier']);
    });

    it('keeps the rows and shows the reason of the server at the input when a label expression is refused', async () => {
      const lab = serveLab({
        file: [some('file', 'a'), some('file', 'b')],
      });

      const { user } = renderList();
      await tableOf();
      expect(rowNames()).toHaveLength(2);

      await user.click(screen.getByRole('button', { name: /^Labels/ }));
      const panel = await screen.findByRole('dialog', {
        name: 'Filter by labels',
      });
      await user.click(
        within(panel).getByRole('button', { name: 'Write an expression' }),
      );
      await user.type(
        within(panel).getByRole('textbox', { name: 'Label expression' }),
        'team=a,,tier',
      );
      await user.click(within(panel).getByRole('button', { name: 'Apply' }));

      const reason = await screen.findByText("Invalid search term: ''.");
      await waitFor(() => expect(reason).toBeVisible());
      expect(rowNames()).toHaveLength(2);
      expect(
        screen.queryByText('Distributions could not be displayed.'),
      ).not.toBeInTheDocument();
      expect(lastQuery(lab).get('pulp_label_select')).toBe('team=a,,tier');
    });

    it('starts again from the first page when a filter is applied', async () => {
      serveLab({
        file: Array.from({ length: 30 }, (_, n) =>
          some('file', `d-${String(n).padStart(2, '0')}`),
        ),
      });

      const { user } = renderList('/distributions?page=2&page_size=10');
      await tableOf();
      await user.type(
        screen.getByPlaceholderText(/filter by name/i),
        'd-1{Enter}',
      );

      await waitFor(() =>
        expect(location()).toBe(
          '/distributions?page_size=10&name__icontains=d-1',
        ),
      );
    });

    it('shows the filter bar and a way out when a filter matches nothing', async () => {
      serveLab({ file: [some('file', 'a')] });

      const { user } = renderList('/distributions?name__icontains=zzz');

      await screen.findByText(/no results found/i);
      expect(screen.getByPlaceholderText(/filter by name/i)).toBeVisible();
      await user.click(
        screen.getAllByRole('button', {
          name: 'Clear all filters',
        })[0] as HTMLElement,
      );
      await waitFor(() => expect(location()).toBe('/distributions'));
      await tableOf();
    });

    describe('sorting', () => {
      const SORTS = ['name', 'pulp_type', 'base_path', 'pulp_created'];

      it('offers a sort control on the name, plugin, base path and created date only', async () => {
        serveLab({ file: [some('file', 'a')] });

        renderList();
        const table = await tableOf();

        expect(
          Array.from(table.querySelectorAll('[data-cy^="sort_"]')).map((icon) =>
            icon.getAttribute('data-cy'),
          ),
        ).toEqual([
          'sort_name',
          'sort_pulp_type',
          'sort_base_path',
          'sort_pulp_created',
        ]);
      });

      it.each(SORTS)(
        'sends ordering=%s in both directions when the column is sorted and keeps it in the address',
        async (field) => {
          const lab = serveLab({
            file: [some('file', 'a'), some('file', 'b')],
          });

          const { user } = renderList();
          await tableOf();
          const sortBy = () =>
            user.click(
              document.querySelector(
                `[data-cy="sort_${field}"]`,
              ) as HTMLElement,
            );

          await sortBy();
          await waitFor(() =>
            expect(lastQuery(lab).get('ordering')).toBe(`-${field}`),
          );
          expect(location()).toBe(`/distributions?sort=-${field}`);

          await sortBy();
          await waitFor(() =>
            expect(location()).toBe(
              field === 'name'
                ? '/distributions'
                : `/distributions?sort=${field}`,
            ),
          );
          // the order of the name was read with the first load already
          if (field !== 'name') {
            await waitFor(() =>
              expect(lastQuery(lab).get('ordering')).toBe(field),
            );
          }
        },
      );

      it('reads the order, the filters and the page of the address after a reload', async () => {
        const lab = serveLab({
          file: Array.from({ length: 30 }, (_, n) =>
            some('file', `d-${String(n).padStart(2, '0')}`),
          ),
        });

        renderList(
          '/distributions?page=2&page_size=10&sort=-pulp_created&name__icontains=d&base_path__icontains=d-&plugin=file',
        );
        await tableOf();

        const query = lastQuery(lab);
        expect(query.get('ordering')).toBe('-pulp_created');
        expect(query.get('offset')).toBe('10');
        expect(query.get('limit')).toBe('10');
        expect(query.get('name__icontains')).toBe('d');
        expect(query.get('base_path__icontains')).toBe('d-');
        expect(query.get('pulp_type__in')).toBe('file.file');
      });

      it('never sorts the served state, guard or serves columns', async () => {
        serveLab({ file: [some('file', 'a')] });

        renderList('/distributions?sort=-served');
        await tableOf();

        for (const id of ['served', 'guard', 'serves', 'url']) {
          expect(
            document.querySelector(`[data-cy="sort_${id}"]`),
          ).not.toBeInTheDocument();
        }
      });
    });
  },
);

const GUARD =
  '/pulp/api/v3/contentguards/core/rbac/00000000-0000-4000-8000-0000000000a1/';

const guarded = (
  plugin: TestDistributionPlugin,
  name: string,
  overrides: Partial<IDistribution> = {},
) => some(plugin, name, { content_guard: GUARD, ...overrides });

const FILE_INDEX = '*/pulp/api/v3/distributions/file/file/';

// The URL of a recorded request to the list of every distribution is what the
// server is sent: the path and the query.
const urlLengthOf = (query: URLSearchParams) =>
  `/pulp/api/v3/distributions/?${query.toString()}`.length;

describe(
  'Integration: the public only filter',
  { tags: ['integration'] },
  () => {
    const PLUGINS = ['core', 'file', 'rpm', 'deb'];

    it('lists exactly the distributions without a content guard, with one request for the list when their addresses fit', async () => {
      reportPlugins(PLUGINS);
      const open = [some('file', 'f-open-1'), some('file', 'f-open-2')];
      const lab = serveLab({
        file: [...open, guarded('file', 'f-closed')],
        rpm: [guarded('rpm', 'r-closed')],
        deb: [some('deb', 'd-open')],
      });

      renderList('/distributions?public=true');
      await tableOf();

      expect(rowNames()).toEqual(['d-open', 'f-open-1', 'f-open-2']);
      expect(screen.queryByText('f-closed')).not.toBeInTheDocument();
      expect(screen.queryByText('r-closed')).not.toBeInTheDocument();

      // one read of the list, with the addresses of the three public rows
      const asked = lab.core.queries.filter((query) =>
        query.has('pulp_href__in'),
      );
      expect(asked).toHaveLength(1);
      expect(
        (asked[0] as URLSearchParams).get('pulp_href__in')?.split(','),
      ).toEqual(expect.arrayContaining([...open.map((row) => row.pulp_href)]));
      expect(
        (asked[0] as URLSearchParams).get('pulp_href__in')?.split(','),
      ).toHaveLength(3);
      // each plugin's distributions were read once, with the guard named
      for (const plugin of ['file', 'rpm', 'deb'] as const) {
        const reads = lab.own[plugin].queries.filter(
          (query) => query.get('limit') === '1000',
        );
        expect(reads).toHaveLength(1);
        expect((reads[0] as URLSearchParams).getAll('fields')).toContain(
          'content_guard',
        );
      }
    });

    it('says that it reads every distribution while it is on, and not otherwise', async () => {
      reportPlugins(PLUGINS);
      serveLab({ file: [some('file', 'a'), guarded('file', 'b')] });

      const { user } = renderList('/distributions?public=true');
      await tableOf();
      expect(
        screen.getByText('Reading every distribution to find the public ones'),
      ).toBeVisible();

      await user.click(screen.getByRole('switch', { name: 'Public only' }));

      await waitFor(() => expect(location()).toBe('/distributions'));
      await waitFor(() =>
        expect(
          screen.queryByText(
            'Reading every distribution to find the public ones',
          ),
        ).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(rowNames()).toEqual(['a', 'b']));
    });

    it('is turned on by the switch, held in the address, and shown as a chip that turns it off', async () => {
      reportPlugins(PLUGINS);
      serveLab({ file: [some('file', 'a'), guarded('file', 'b')] });

      const { user } = renderList();
      await tableOf();
      expect(
        screen.getByRole('switch', { name: 'Public only' }),
      ).not.toBeChecked();
      await user.click(screen.getByRole('switch', { name: 'Public only' }));

      await waitFor(() =>
        expect(location()).toBe('/distributions?public=true'),
      );
      await waitFor(() => expect(rowNames()).toEqual(['a']));
      expect(screen.getByRole('switch', { name: 'Public only' })).toBeChecked();

      await user.click(
        document.querySelector(
          '.pf-v6-c-label-group .pf-v6-c-label button',
        ) as HTMLElement,
      );
      await waitFor(() => expect(location()).toBe('/distributions'));
    });

    it('combines with the name filter and returns only public rows that match', async () => {
      reportPlugins(PLUGINS);
      const lab = serveLab({
        file: [
          some('file', 'manual-open'),
          guarded('file', 'manual-closed'),
          some('file', 'image-open'),
        ],
      });

      renderList('/distributions?public=true&name__icontains=manual');
      await tableOf();

      expect(rowNames()).toEqual(['manual-open']);
      const query = lab.core.queries.at(-1) as URLSearchParams;
      expect(query.get('name__icontains')).toBe('manual');
      expect(query.has('pulp_href__in')).toBe(true);
    });

    it('reads only the indexes of the plugins chosen', async () => {
      reportPlugins(PLUGINS);
      const lab = serveLab({
        file: [some('file', 'f-open')],
        rpm: [some('rpm', 'r-open')],
      });

      renderList('/distributions?public=true&plugin=rpm');
      await tableOf();

      expect(rowNames()).toEqual(['r-open']);
      const indexReads = (plugin: 'file' | 'rpm') =>
        lab.own[plugin].queries.filter(
          (query) => query.get('limit') === '1000',
        );
      expect(indexReads('file')).toHaveLength(0);
      expect(indexReads('rpm')).toHaveLength(1);
    });

    it('reads every group of addresses once when they do not fit one request, and orders and pages in the browser', async () => {
      reportPlugins(['core', 'file']);
      const many = Array.from({ length: 150 }, (_, n) =>
        some('file', `public-${String(n).padStart(3, '0')}`, {
          base_path: `p/${String(149 - n).padStart(3, '0')}`,
        }),
      );
      const lab = serveLab({
        file: [
          ...many,
          guarded('file', 'closed-1'),
          guarded('file', 'closed-2'),
        ],
      });

      const { user } = renderList('/distributions?public=true&page_size=10');
      await tableOf();

      const reads = () =>
        lab.core.queries.filter((query) => query.has('pulp_href__in'));
      const groups = reads();
      expect(groups.length).toBeGreaterThan(1);
      for (const query of groups) {
        expect(urlLengthOf(query)).toBeLessThanOrEqual(3500);
      }
      // together the groups name every public row exactly once
      const named = groups.flatMap(
        (query) => query.get('pulp_href__in')?.split(',') ?? [],
      );
      expect(new Set(named).size).toBe(150);
      expect(named).toHaveLength(150);

      expect(rowNames()).toHaveLength(10);
      expect(rowNames()[0]).toBe('public-000');
      expect(screen.queryByText('closed-1')).not.toBeInTheDocument();
      const before = lab.core.queries.length;

      // another page and another order are cut from what is held
      await user.click(
        screen.getAllByRole('button', { name: /next page/i })[0] as HTMLElement,
      );
      await waitFor(() => expect(rowNames()[0]).toBe('public-010'));
      await user.click(
        document.querySelector('[data-cy="sort_base_path"]') as HTMLElement,
      );
      await waitFor(() =>
        expect(location()).toBe(
          '/distributions?page_size=10&sort=-base_path&public=true',
        ),
      );
      expect(lab.core.queries.length).toBe(before);
    });

    it('shows the loading state, and no empty result, while an index is still being read', async () => {
      reportPlugins(['core', 'file']);
      const lab = serveLab({ file: [some('file', 'a'), guarded('file', 'b')] });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(FILE_INDEX, async () => {
          await gate;
          return HttpResponse.json(
            page([some('file', 'a', { content_guard: null })]),
          );
        }),
      );

      renderList('/distributions?public=true');

      await screen.findByRole('progressbar');
      expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText('No distributions yet'),
      ).not.toBeInTheDocument();
      expect(
        lab.core.queries.filter((query) => query.has('pulp_href__in')),
      ).toHaveLength(0);

      release();
      // the answer names a row that the core list does not hold: the list
      // is what the core list answers, not the index
      await screen.findByText(/no results found/i);
    });

    it('is an error with Retry when an index cannot be read, never an empty list', async () => {
      reportPlugins(['core', 'file']);
      const a = some('file', 'a');
      serveLab({ file: [a] });
      let healthy = false;
      server.use(
        http.get(FILE_INDEX, () =>
          healthy
            ? HttpResponse.json(page([{ ...a, content_guard: null }]))
            : HttpResponse.json({ detail: 'down' }, { status: 500 }),
        ),
      );

      const { user } = renderList('/distributions?public=true');

      await screen.findByText('Distributions could not be displayed.');
      expect(screen.queryByText(/no results found/i)).not.toBeInTheDocument();

      healthy = true;
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await tableOf();
      expect(rowNames()).toEqual(['a']);
    });

    it('says nothing matches, offers to clear the filters, and sends no request for the list, when no distribution is public', async () => {
      reportPlugins(['core', 'file']);
      const lab = serveLab({
        file: [guarded('file', 'a'), guarded('file', 'b')],
      });

      const { user } = renderList('/distributions?public=true');

      await screen.findByText(/no results found/i);
      expect(
        lab.core.queries.filter((query) => query.has('pulp_href__in')),
      ).toHaveLength(0);
      expect(screen.getByRole('switch', { name: 'Public only' })).toBeChecked();

      await user.click(
        screen.getAllByRole('button', {
          name: 'Clear all filters',
        })[0] as HTMLElement,
      );
      await waitFor(() => expect(location()).toBe('/distributions'));
      await tableOf();
      expect(rowNames()).toEqual(['a', 'b']);
    });

    it('never lists a guarded distribution even when the server ignores the address filter', async () => {
      reportPlugins(['core', 'file']);
      const open = some('file', 'open');
      const closed = guarded('file', 'closed');
      serveLab({ file: [open, closed] });
      // a server that answers every row whatever the filter
      server.use(
        http.get('*/pulp/api/v3/distributions/', () =>
          HttpResponse.json(page([open, closed].map(coreDistributionRow))),
        ),
      );

      renderList('/distributions?public=true');
      await tableOf();

      expect(rowNames()).toEqual(['open']);
      expect(screen.queryByText('closed')).not.toBeInTheDocument();
    });
  },
);
