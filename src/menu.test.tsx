import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { useRoutes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type IPermissionSetup,
  servePermissions,
} from 'src/test-utils/permissions';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { settle } from 'src/test-utils/settle';
import { dataRoutes } from './app-routes';
import { PLUGIN_MANIFESTS } from './framework/manifest';
import { PulpMenu, useMenuModel } from './menu';

const guardedRoutes = (dataRoutes[0]?.children?.[0]?.children ?? []).filter(
  (route) => 'path' in route,
);

// A page as the application lays it out: the menu next to the routed screen.
function MenuAndRoutes() {
  return (
    <>
      <PulpMenu />
      {useRoutes(guardedRoutes)}
    </>
  );
}

// Signs in a user zoe (staff unless the setup says otherwise) and serves the
// reads the permission provider makes for her.
function signIn(setup: IPermissionSetup = { isStaff: true }) {
  return servePermissions({ id: 1, username: 'zoe', ...setup });
}

function reportPlugins(components: string[]) {
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
}

// Answers status/ with the given outcomes in turn (the last one repeats) and
// counts the requests.
function answerPlugins(...outcomes: ('fail' | 'ok')[]) {
  const counter = { requests: 0 };
  server.use(
    http.get('*/pulp/api/v3/status/', () => {
      const outcome = outcomes[Math.min(counter.requests, outcomes.length - 1)];
      counter.requests += 1;
      return outcome === 'ok'
        ? HttpResponse.json({
            versions: ALL_PLUGINS.map((component) => ({
              component,
              version: '3.0.0',
            })),
          })
        : HttpResponse.json({ detail: 'Failed.' }, { status: 500 });
    }),
  );
  return counter;
}

const PLUGIN_ROW = 'The plugin list could not be loaded';

const ALL_PLUGINS = ['core', 'file', 'deb', 'rpm', 'python', 'ansible'];

const item = (id: string) =>
  document.querySelector<HTMLAnchorElement>(`[data-cy=pulp-menu-item-${id}]`);
const section = (id: string) =>
  document.querySelector<HTMLElement>(`[data-cy=pulp-menu-section-${id}]`);
const sectionToggle = (id: string) =>
  section(id)?.querySelector<HTMLButtonElement>(
    ':scope > button',
  ) as HTMLButtonElement;
const labels = (links: Element[]) => links.map((link) => link.textContent);

// The menu shows its signed-in entries once the session answered.
async function menuShown(route = '/status') {
  const rendered = renderWithProviders(<PulpMenu />, { route });
  await screen.findByRole('link', { name: 'Tasks' });
  return rendered;
}

afterEach(() => {
  vi.useRealTimers();
  server.events.removeAllListeners();
});

describe('navigation menu', () => {
  it('groups the entries by task: Content, Operations and Access', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual(['Content', 'Operations', 'Access']);

    const content = screen.getByRole('region', { name: 'Content' });
    expect(
      within(content)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Repositories', 'Packages and artifacts', 'Remotes']);

    const operations = screen.getByRole('region', { name: 'Operations' });
    expect(
      within(operations)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Tasks', 'Workers and status', 'Signing services']);

    const access = screen.getByRole('region', { name: 'Access' });
    expect(
      within(access)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Users and groups']);
    expect(
      within(access)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Roles']);
  });

  it('opens Repositories and Remotes onto every installed plugin and Packages and artifacts onto the content lists of File, deb, RPM and Python', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });

    const second = (id: string) =>
      labels(Array.from(section(id)?.querySelectorAll('a') ?? []));
    expect(second('repositories')).toEqual([
      'File',
      'deb',
      'RPM',
      'Python',
      'Ansible',
    ]);
    expect(second('remotes')).toEqual([
      'File',
      'deb',
      'RPM',
      'Python',
      'Ansible',
    ]);
    expect(second('packages')).toEqual(['File', 'deb', 'RPM', 'Python']);
    expect(second('users-and-groups')).toEqual(['Users', 'Groups']);
  });

  it('takes the plugin entries from the manifests, one for each resource a manifest lists', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);
    const file = PLUGIN_MANIFESTS.find(({ plugin }) => plugin === 'file');
    const resources = file?.resources;
    if (!file || !resources) {
      throw new Error('the file manifest is missing');
    }
    file.resources = ['repository'];

    try {
      await menuShown();
      await screen.findByRole('button', { name: 'Repositories' });

      const second = (id: string) =>
        labels(Array.from(section(id)?.querySelectorAll('a') ?? []));
      expect(second('repositories')).toEqual([
        'File',
        'deb',
        'RPM',
        'Python',
        'Ansible',
      ]);
      expect(second('remotes')).toEqual(['deb', 'RPM', 'Python', 'Ansible']);
    } finally {
      file.resources = resources;
    }
  });

  it('offers one Distributions entry in the Content group, above every plugin, when a plugin with distributions is installed', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });

    const content = screen.getByRole('region', { name: 'Content' });
    const link = within(content).getByRole('link', { name: 'Distributions' });
    expect(link).toHaveAttribute('href', '/distributions/');
    expect(link).toHaveAttribute('data-cy', 'pulp-menu-item-distributions');
    expect(
      Array.from(
        document.querySelectorAll('[data-cy=pulp-menu-item-distributions]'),
      ),
    ).toHaveLength(1);
  });

  it('offers the Distributions entry only for a plugin whose manifest lists distributions', async () => {
    signIn();
    reportPlugins(['core', 'file']);
    const file = PLUGIN_MANIFESTS.find(({ plugin }) => plugin === 'file');
    const resources = file?.resources;
    if (!file || !resources) {
      throw new Error('the file manifest is missing');
    }
    file.resources = ['repository', 'remote'];

    try {
      await menuShown();
      await screen.findByRole('button', { name: 'Repositories' });

      expect(
        screen.queryByRole('link', { name: 'Distributions' }),
      ).not.toBeInTheDocument();
    } finally {
      file.resources = resources;
    }
  });

  it('offers the Distributions entry for a plugin that has distributions and no repository screens, and no repository or remote entry for it', async () => {
    signIn();
    reportPlugins(['core', 'maven']);

    await menuShown();

    await screen.findByRole('link', { name: 'Distributions' });
    expect(section('repositories')).toBeNull();
    expect(section('remotes')).toBeNull();
  });

  it('marks the Distributions entry as current on the list', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    await menuShown('/distributions/');

    await waitFor(() => expect(item('distributions')).not.toBeNull());
    expect(item('distributions')).toHaveAttribute('aria-current', 'page');
  });

  it('offers no Distributions entry when no plugin with distributions is installed', async () => {
    signIn();
    reportPlugins(['core', 'certguard']);

    await menuShown();

    expect(
      screen.queryByRole('link', { name: 'Distributions' }),
    ).not.toBeInTheDocument();
  });

  it('gives every entry a stable id that does not depend on its text', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });

    const expected: Record<string, string> = {
      'pulp-menu-item-status': '/status/',
      'pulp-menu-item-tasks': '/tasks/',
      'pulp-menu-item-signing-services': '/signature-keys/',
      'pulp-menu-item-users': '/users/',
      'pulp-menu-item-groups': '/groups/',
      'pulp-menu-item-roles': '/roles/',
      'pulp-menu-item-file-repositories': '/file/repositories/',
      'pulp-menu-item-deb-repositories': '/deb/repositories/',
      'pulp-menu-item-rpm-repositories': '/rpm/repositories/',
      'pulp-menu-item-python-repositories': '/python/repositories/',
      'pulp-menu-item-ansible-repositories': '/ansible/repositories/',
      'pulp-menu-item-file-remotes': '/file/remotes/',
      'pulp-menu-item-ansible-remotes': '/ansible/remotes/',
      'pulp-menu-item-file-content': '/file/content/',
      'pulp-menu-item-deb-content': '/deb/content/',
      'pulp-menu-item-rpm-content': '/rpm/content/',
      'pulp-menu-item-python-content': '/python/content/',
    };
    for (const [hook, path] of Object.entries(expected)) {
      expect(document.querySelector(`[data-cy=${hook}]`), hook).toHaveAttribute(
        'href',
        path,
      );
    }
    expect(item('login')).toBeNull();
    for (const id of [
      'repositories',
      'packages',
      'remotes',
      'users-and-groups',
    ]) {
      expect(section(id), `pulp-menu-section-${id}`).not.toBeNull();
    }
  });

  it('offers no second-level entry for a plugin the server does not report', async () => {
    signIn();
    reportPlugins(['core', 'file', 'rpm']);

    await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });

    expect(item('file-repositories')).not.toBeNull();
    expect(item('rpm-repositories')).not.toBeNull();
    expect(item('deb-repositories')).toBeNull();
    expect(item('python-repositories')).toBeNull();
    expect(item('ansible-repositories')).toBeNull();
    expect(item('python-content')).toBeNull();
    expect(item('deb-content')).toBeNull();
    expect(item('file-content')).not.toBeNull();
    expect(item('rpm-content')).not.toBeNull();
  });

  it('drops Packages and artifacts when no plugin that has content lists is installed', async () => {
    signIn();
    reportPlugins(['core', 'ansible']);

    await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });

    expect(section('packages')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Packages and artifacts' }),
    ).not.toBeInTheDocument();
  });

  it('shows no group label for a group without a visible entry', async () => {
    signIn();
    reportPlugins(['core']);

    await menuShown();
    await waitFor(() =>
      expect(
        screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
      ).toEqual(['Operations', 'Access']),
    );
    expect(
      screen.queryByRole('heading', { name: 'Content' }),
    ).not.toBeInTheDocument();
  });

  it('never offers the screens that do not exist', async () => {
    signIn();
    reportPlugins([...ALL_PLUGINS, 'container', 'certguard']);

    await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });

    const nav = screen.getByRole('navigation', { name: 'Main' });
    for (const text of [
      'Overview',
      'Content guards',
      'Search',
      'Collections',
      'Namespaces',
      'Containers',
      'Remote registries',
      'About project',
      'Approvals',
      'Imports',
    ]) {
      expect(within(nav).queryByText(text), text).not.toBeInTheDocument();
    }
  });

  it('offers only Login when signed out', async () => {
    reportPlugins(ALL_PLUGINS);

    renderWithProviders(<PulpMenu />);
    await screen.findByRole('link', { name: 'Login' });

    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(labels(Array.from(nav.querySelectorAll('a')))).toEqual(['Login']);
    expect(item('login')).toHaveAttribute('href', '/login/');
    expect(item('status')).toBeNull();
    expect(within(nav).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('heading')).toEqual([]);
  });

  it('sends no request to status/ while signed out', async () => {
    const statusRequests: string[] = [];
    const onStart = ({ request }: { request: Request }) => {
      const { pathname } = new URL(request.url);
      if (pathname.endsWith('/status/')) {
        statusRequests.push(pathname);
      }
    };
    server.events.on('request:start', onStart);

    renderWithProviders(<PulpMenu />);
    await screen.findByRole('link', { name: 'Login' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.events.removeListener('request:start', onStart);

    expect(statusRequests).toEqual([]);
  });

  it('renders the fixed entries at once while the plugin list loads, without plugin entries', async () => {
    signIn();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/pulp/api/v3/status/', async () => {
        await gate;
        return HttpResponse.json({
          versions: ALL_PLUGINS.map((component) => ({
            component,
            version: '3.0.0',
          })),
        });
      }),
    );

    await menuShown();

    expect(item('tasks')).not.toBeNull();
    expect(item('status')).not.toBeNull();
    // The entries that depend on the permissions follow their read.
    await waitFor(() => expect(item('roles')).not.toBeNull());
    expect(item('signing-services')).not.toBeNull();
    expect(section('users-and-groups')).not.toBeNull();
    expect(section('repositories')).toBeNull();
    expect(section('remotes')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Content' })).toBeNull();

    release();
    expect(
      await screen.findByRole('button', { name: 'Repositories' }),
    ).toBeVisible();
  });

  it('keeps the menu as while loading after the first failed read and shows the row only when the second read fails', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const counter = answerPlugins('fail');

    renderWithProviders(<PulpMenu />);
    await settle();

    expect(counter.requests).toBe(1);
    expect(item('tasks')).not.toBeNull();
    expect(item('roles')).not.toBeNull();
    expect(section('repositories')).toBeNull();
    expect(screen.queryByText(PLUGIN_ROW)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Content' })).toBeNull();

    await settle(3000);

    expect(counter.requests).toBe(2);
    const content = screen.getByRole('region', { name: 'Content' });
    const row = within(content).getByRole('status');
    expect(row).toHaveTextContent(PLUGIN_ROW);
    expect(
      within(row).getByRole('button', {
        name: 'Retry loading the plugin list',
      }),
    ).toBeVisible();
    expect(screen.getByRole('region', { name: 'Operations' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Access' })).toBeVisible();
    expect(item('tasks')).not.toBeNull();
    expect(section('repositories')).toBeNull();
  });

  it('shows no row when the second read succeeds', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    answerPlugins('fail', 'ok');

    renderWithProviders(<PulpMenu />);
    await settle(3000);

    expect(screen.queryByText(PLUGIN_ROW)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Repositories' }),
    ).toBeInTheDocument();
  });

  it('shows the row with a busy Retry while it asks again, keeps it and the focus when that fails too', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const counter = answerPlugins('fail');
    renderWithProviders(<PulpMenu />);
    await settle(3000);
    vi.useRealTimers();

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/pulp/api/v3/status/', async () => {
        counter.requests += 1;
        await gate;
        return HttpResponse.json({ detail: 'Failed.' }, { status: 500 });
      }),
    );
    const user = userEvent.setup();
    const retry = screen.getByRole('button', {
      name: 'Retry loading the plugin list',
    });

    await user.click(retry);

    await waitFor(() => expect(retry).toHaveAttribute('aria-disabled', 'true'));
    expect(retry).toHaveClass('pf-m-in-progress');
    expect(screen.getByText(PLUGIN_ROW)).toBeVisible();
    expect(retry).toHaveFocus();
    const before = counter.requests;
    await user.click(retry);
    expect(counter.requests).toBe(before);

    release();
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled'));

    expect(retry).not.toHaveClass('pf-m-in-progress');
    expect(screen.getByText(PLUGIN_ROW)).toBeVisible();
    expect(retry).toHaveFocus();
    expect(section('repositories')).toBeNull();
  });

  it('removes the row and moves the focus to the first entry of the Content group when Retry succeeds', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    answerPlugins('fail');
    renderWithProviders(<PulpMenu />);
    await settle(3000);
    vi.useRealTimers();
    const user = userEvent.setup();
    expect(screen.getByText(PLUGIN_ROW)).toBeVisible();

    reportPlugins(ALL_PLUGINS);
    await user.click(
      screen.getByRole('button', { name: 'Retry loading the plugin list' }),
    );

    const repositories = await screen.findByRole('button', {
      name: 'Repositories',
    });
    expect(screen.queryByText(PLUGIN_ROW)).not.toBeInTheDocument();
    expect(item('tasks')).not.toBeNull();
    await waitFor(() => expect(repositories).toHaveFocus());
  });

  it('leaves the focus where it is when Retry succeeds after the user moved it elsewhere', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    answerPlugins('fail');
    renderWithProviders(<PulpMenu />);
    await settle(3000);
    vi.useRealTimers();
    const user = userEvent.setup();

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/pulp/api/v3/status/', async () => {
        await gate;
        return HttpResponse.json({
          versions: ALL_PLUGINS.map((component) => ({
            component,
            version: '3.0.0',
          })),
        });
      }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Retry loading the plugin list' }),
    );
    (item('tasks') as HTMLElement).focus();

    release();
    const repositories = await screen.findByRole('button', {
      name: 'Repositories',
    });

    expect(repositories).not.toHaveFocus();
    expect(item('tasks')).toHaveFocus();
  });

  it('shows no plugin entry and raises no unhandled rejection when the plugins cannot be read', async () => {
    signIn();
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ detail: 'Failed.' }, { status: 500 }),
      ),
    );
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);

    try {
      renderWithProviders(<PulpMenu />);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.off('unhandledRejection', onRejection);
    }

    expect(item('file-repositories')).toBeNull();
    expect(item('rpm-repositories')).toBeNull();
    expect(rejections).toEqual([]);
  });

  it('shares one read of the installed plugins with the screen it is shown beside', async () => {
    signIn();
    const statusRequests: string[] = [];
    const onStart = ({ request }: { request: Request }) => {
      const { pathname } = new URL(request.url);
      if (pathname.endsWith('/status/')) {
        statusRequests.push(pathname);
      }
    };
    server.events.on('request:start', onStart);

    renderWithProviders(<MenuAndRoutes />, { route: '/ansible/collections' });

    expect(
      await screen.findByRole('button', { name: 'Repositories' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Collections', level: 1 }),
    ).toBeVisible();
    server.events.removeListener('request:start', onStart);

    expect(statusRequests).toHaveLength(1);
  });

  it('re-reads the plugins on a new page load', async () => {
    signIn();
    reportPlugins(['core', 'file', 'rpm']);

    const withRpm = await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });
    expect(item('rpm-repositories')).not.toBeNull();
    withRpm.unmount();

    reportPlugins(['core', 'file']);
    await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });
    expect(item('file-repositories')).not.toBeNull();
    expect(item('rpm-repositories')).toBeNull();
  });

  it('expands the section that holds the current route and marks the current entry', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    await menuShown('/deb/repositories');
    await screen.findByRole('button', { name: 'Repositories' });

    expect(sectionToggle('repositories')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(sectionToggle('remotes')).toHaveAttribute('aria-expanded', 'false');
    expect(item('deb-repositories')).toHaveAttribute('aria-current', 'page');
    expect(item('file-repositories')).not.toHaveAttribute('aria-current');
    expect(item('tasks')).not.toHaveAttribute('aria-current');
  });

  it('marks the entry of a detail screen as current', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    await menuShown('/groups/7');
    await waitFor(() => expect(item('groups')).not.toBeNull());

    expect(item('groups')).toHaveAttribute('aria-current', 'page');
    expect(sectionToggle('users-and-groups')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('keeps a section the user toggled while navigating', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    const { user } = await menuShown('/deb/repositories');
    await screen.findByRole('button', { name: 'Repositories' });

    // The user closes the section that holds the current route and opens
    // another one, then follows a link inside it.
    await user.click(sectionToggle('repositories'));
    expect(sectionToggle('repositories')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await user.click(sectionToggle('remotes'));
    await user.click(item('deb-remotes') as HTMLElement);

    expect(item('deb-remotes')).toHaveAttribute('aria-current', 'page');
    expect(sectionToggle('remotes')).toHaveAttribute('aria-expanded', 'true');
    expect(sectionToggle('repositories')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('renders the Tasks label in its own element', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    await menuShown();

    const label = item('tasks')?.querySelector('.pf-v6-c-nav__link-text');
    expect(label).toHaveTextContent(/^Tasks$/);
  });

  it('gives first-level entries a hidden icon and second-level entries none', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });

    const icon = item('tasks')?.querySelector('.pf-v6-c-nav__link-icon');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(
      item('deb-repositories')?.querySelector('.pf-v6-c-nav__link-icon'),
    ).toBeNull();
  });
});

describe('administration entries', () => {
  const accessEntries = () =>
    ['users', 'groups', 'roles'].filter((id) => item(id) !== null);

  // Lets the permission reads (own record, own roles) answer before a test
  // asserts that something is still absent.
  async function permissionsRead(requests: string[]) {
    await waitFor(() =>
      expect(requests.some((path) => path.includes('/roles/'))).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  it('offers no Users, Groups, Roles, Users and groups or Access label to a viewer without the permissions', async () => {
    const { requests } = signIn({ own: [['file.view_filerepository']] });
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await permissionsRead(requests);

    expect(accessEntries()).toEqual([]);
    expect(section('users-and-groups')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Access' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
    ).toEqual(['Content', 'Operations']);
  });

  it('offers Groups under Users and groups to a holder of core.view_group only, without Users and Roles', async () => {
    signIn({ own: [['core.view_group']] });
    reportPlugins(ALL_PLUGINS);

    await menuShown();

    await waitFor(() => expect(item('groups')).not.toBeNull());
    expect(item('users')).toBeNull();
    expect(item('roles')).toBeNull();
    expect(section('users-and-groups')).not.toBeNull();
    expect(
      screen.getByRole('heading', { name: 'Access', level: 2 }),
    ).toBeVisible();
  });

  it('offers Users alone to a holder of auth.view_user only', async () => {
    signIn({ own: [['auth.view_user']] });
    reportPlugins(ALL_PLUGINS);

    await menuShown();

    await waitFor(() => expect(item('users')).not.toBeNull());
    expect(item('groups')).toBeNull();
    expect(item('roles')).toBeNull();
  });

  it('takes the permissions of a group role into account', async () => {
    signIn({ groups: [{ id: 3, roles: [['core.view_group']] }] });
    reportPlugins(ALL_PLUGINS);

    await menuShown();

    await waitFor(() => expect(item('groups')).not.toBeNull());
    expect(item('users')).toBeNull();
  });

  it('offers Roles only to staff, never for a holder of other role permissions', async () => {
    signIn({
      own: [['core.view_role', 'core.change_role', 'core.delete_role']],
    });
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(item('roles')).toBeNull();
  });

  it('offers all three to staff', async () => {
    signIn({ isStaff: true });
    reportPlugins(ALL_PLUGINS);

    await menuShown();

    await waitFor(() =>
      expect(accessEntries()).toEqual(['users', 'groups', 'roles']),
    );
  });

  it('shows none of them while the permissions are pending or after the read failed', async () => {
    signIn({ isStaff: true });
    server.use(
      http.get('*/pulp/api/v3/users/1/', () =>
        HttpResponse.json({ detail: 'no' }, { status: 500 }),
      ),
    );
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(accessEntries()).toEqual([]);
    expect(
      screen.queryByRole('heading', { name: 'Access' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the entries above Access in place when Groups appears after the permission read', async () => {
    signIn({ own: [['core.view_group']] });
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await screen.findByRole('button', { name: 'Repositories' });
    const order = () =>
      screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);

    expect(order().slice(0, 2)).toEqual(['Content', 'Operations']);
    await waitFor(() => expect(item('groups')).not.toBeNull());
    expect(order()).toEqual(['Content', 'Operations', 'Access']);
  });

  it('lists the screens of the model the same way', async () => {
    signIn({ own: [['core.view_group']] });
    reportPlugins(['core']);

    renderWithProviders(<ModelList />);

    await screen.findByText('Users and groups - Groups');
    expect(screen.queryByText('Users and groups - Users')).toBeNull();
    expect(screen.queryByText('Roles')).toBeNull();
    expect(screen.queryByText('Signing services')).toBeNull();
  });
});

describe('the Signing services entry', () => {
  it('is offered to a holder of core.view_signingservice and to staff', async () => {
    signIn({ own: [['core.view_signingservice']] });
    reportPlugins(ALL_PLUGINS);

    const holder = await menuShown();
    await waitFor(() => expect(item('signing-services')).not.toBeNull());
    expect(item('signing-services')).toHaveAttribute(
      'href',
      '/signature-keys/',
    );
    holder.unmount();
    server.events.removeAllListeners();

    signIn({ isStaff: true });
    await menuShown();
    await waitFor(() => expect(item('signing-services')).not.toBeNull());
  });

  it('is not offered to a viewer without the permission, in the sidebar or the search list', async () => {
    const { requests } = signIn({ own: [['file.view_filerepository']] });
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await waitFor(() =>
      expect(requests.some((path) => path.includes('/roles/'))).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(item('signing-services')).toBeNull();
    expect(screen.queryByText('Signing services')).toBeNull();
    // Tasks and Workers and status stay in the Operations group.
    expect(item('tasks')).not.toBeNull();
    expect(item('status')).not.toBeNull();
  });

  it('is not offered while the permissions are unknown or after the read failed', async () => {
    signIn({ own: [['core.view_signingservice']] });
    server.use(
      http.get('*/pulp/api/v3/users/1/', () =>
        HttpResponse.json({ detail: 'no' }, { status: 500 }),
      ),
    );
    reportPlugins(ALL_PLUGINS);

    await menuShown();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(item('signing-services')).toBeNull();
  });
});

function ModelList() {
  const { screens } = useMenuModel();
  return (
    <ul>
      {screens.map((screenEntry) => (
        <li key={screenEntry.id} data-path={screenEntry.path}>
          {screenEntry.label}
        </li>
      ))}
    </ul>
  );
}

describe('menu model', () => {
  it('lists the visible screens in sidebar order with the plugin in second-level labels', async () => {
    signIn();
    reportPlugins(['core', 'deb', 'python']);

    renderWithProviders(<ModelList />);

    await screen.findByText('Repositories - deb');
    const listed = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(listed).toEqual([
      'Repositories - deb',
      'Repositories - Python',
      'Distributions',
      'Packages and artifacts - Python',
      'Remotes - deb',
      'Remotes - Python',
      'Tasks',
      'Workers and status',
      'Signing services',
      'Users and groups - Users',
      'Users and groups - Groups',
      'Roles',
    ]);
    expect(
      screen.getByText('Repositories - deb').getAttribute('data-path'),
    ).toBe('/deb/repositories/');
  });

  it('lists only Login when signed out', async () => {
    reportPlugins(ALL_PLUGINS);

    renderWithProviders(<ModelList />);

    await screen.findByText('Login');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(
      ['Login'],
    );
  });
});
