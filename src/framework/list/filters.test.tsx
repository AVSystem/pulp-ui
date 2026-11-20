import { screen, waitFor, within } from '@testing-library/react';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IRepository,
  distributionListHandler,
  pluginListHandler,
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

function serveLab(repositories: IRepository[]) {
  const lab = {
    repositories: pluginListHandler('file', 'repository', repositories, {
      pageSize: 1000,
    }),
    distributions: distributionListHandler('file', []),
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
    lab.distributions.handler,
    lab.publications.handler,
    lab.versions.handler,
    lab.tasks.handler,
  );
  return lab;
}

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
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

describe('Integration: the list filters', { tags: ['integration'] }, () => {
  it('sends the name filter with the page, size and order of the list and shows the matching rows', async () => {
    const lab = serveLab(repositories());
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
      within(panel).getByRole('textbox', { name: 'Label key' }),
      'team',
    );
    await user.type(
      within(panel).getByRole('textbox', { name: 'Label value' }),
      'docs',
    );
    await user.click(
      within(panel).getByRole('button', { name: 'Add label condition' }),
    );
    const keys = within(panel).getAllByRole('textbox', { name: 'Label key' });
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
      within(panel).getByRole('textbox', { name: 'Label key' }),
      'old',
    );
    await user.click(
      within(panel).getByRole('button', { name: 'Add label condition' }),
    );
    const keys = within(panel).getAllByRole('textbox', { name: 'Label key' });
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
        .getAllByRole('textbox', { name: 'Label key' })
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
    const before = lab.repositories.queries.length;

    const panel = await openLabelFilter(user);
    await user.type(
      within(panel).getByRole('textbox', { name: 'Label key' }),
      'a,b',
    );

    expect(
      await within(panel).findByText(
        'A key may hold letters, digits, spaces, dots, hyphens and underscores.',
      ),
    ).toBeVisible();
    expect(within(panel).getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(lab.repositories.queries).toHaveLength(before);
  });

  it('accepts a key with a dot and a hyphen and a value with a comma', async () => {
    serveLab(repositories());
    const { user } = renderList();
    await tableOf();

    const panel = await openLabelFilter(user);
    await user.type(
      within(panel).getByRole('textbox', { name: 'Label key' }),
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
      within(panel).getByRole('textbox', { name: 'Label key' }),
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

    expect(await screen.findByText("Invalid search term: ''.")).toBeVisible();
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

    expect(await screen.findByText("Invalid search term: '=x'.")).toBeVisible();
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
      within(panel).getByRole('textbox', { name: 'Label key' }),
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
