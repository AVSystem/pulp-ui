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
  coreDistributionListHandler,
  coreDistributionRow,
  distributionListHandler,
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

// A lab: the rows of every plugin, answered by the cross-plugin list and by
// each plugin's own list, the way the server answers them.
function serveLab(
  rows: Partial<Record<TestDistributionPlugin, IDistribution[]>>,
) {
  const own = Object.entries(rows).map(([plugin, list]) =>
    distributionListHandler(plugin as TestDistributionPlugin, list ?? []),
  );
  const core = coreDistributionListHandler([
    ...Object.values(rows)
      .flatMap((list) => list ?? [])
      .map(coreDistributionRow),
    artifactDistribution(),
  ]);
  server.use(core.handler, ...own.map(({ handler }) => handler));

  return { core, own };
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
      await user.click(await screen.findByRole('option', { name: 'RPM' }));
      await user.click(screen.getByRole('option', { name: 'deb' }));

      await waitFor(() =>
        expect(lastQuery(lab).get('pulp_type__in')).toBe(
          'deb.apt-distribution,rpm.rpm',
        ),
      );
      expect(location()).toBe('/distributions?plugin=deb%2Crpm');
      await waitFor(() => expect(rowNames()).toEqual(['a-deb', 'a-rpm']));

      // one chip per chosen plugin, each removes that plugin only
      const chips = Array.from(
        document.querySelectorAll('.pf-v6-c-label__text'),
      ).map((chip) => chip.textContent);
      expect(chips).toEqual(['deb', 'RPM']);
      await user.click(
        screen.getByRole('button', { name: 'Clear all filters' }),
      );

      await waitFor(() =>
        expect(lastQuery(lab).get('pulp_type__in')).toBe(
          'file.file,deb.apt-distribution,rpm.rpm',
        ),
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
      const panel = await screen.findByRole('dialog', {
        name: 'Filter by labels',
      });
      await user.click(
        within(panel).getByRole('combobox', { name: 'Label key' }),
      );

      expect(
        await screen.findByRole('option', { name: 'owner' }),
      ).toBeVisible();
      expect(screen.getByRole('option', { name: 'team' })).toBeVisible();
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
      const SORTS: [string, string][] = [
        ['name', 'name'],
        ['pulp_type', 'pulp_type'],
        ['base_path', 'base_path'],
        ['pulp_created', 'pulp_created'],
      ];

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
        'sends ordering=%s when the column is sorted and keeps it in the address',
        async (field) => {
          const lab = serveLab({
            file: [some('file', 'a'), some('file', 'b')],
          });

          const { user } = renderList(
            field === 'name' ? '/distributions?sort=-name' : '/distributions',
          );
          await tableOf();
          await user.click(
            document.querySelector(`[data-cy="sort_${field}"]`) as HTMLElement,
          );

          await waitFor(() =>
            expect(lastQuery(lab).get('ordering')).toBe(field),
          );
          expect(location()).toBe(
            field === 'name'
              ? '/distributions'
              : `/distributions?sort=${field}`,
          );
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
