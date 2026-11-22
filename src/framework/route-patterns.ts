import { fillPath } from '../utilities/fill-path';
import type { FrameworkPlugin, ResourceKind } from './manifest';

// Every address of a plugin's repository and remote screens, as plain data and
// pure functions. The router, the menu, the crawler and the end-to-end specs
// all read the addresses from here, so an address is spelled in one place. The
// only runtime import is the path filler that `formatPath` is built on: it
// encodes a name into one path segment, so a name from the address bar or from
// the server can never add or change a segment. The relative import is
// deliberate: the Playwright runner imports this module and does not know the
// `src/` alias, and src/paths.ts would pull the rest of the application in.

// What a route leads to. A screen kind without a screen of its own yet is not
// registered as a route (see frameworkRoutes); the pattern still stands, so
// the crawler and the legacy redirects can rely on it.
export type ScreenKind =
  | 'distribution-list'
  | 'repository-list'
  | 'repository-detail'
  | 'repository-tab'
  | 'repository-edit'
  | 'repository-create'
  | 'remote-list'
  | 'remote-detail'
  | 'remote-edit'
  | 'remote-create'
  | 'distribution-detail'
  | 'distribution-edit'
  | 'distribution-create';

// The tabs a repository can have a sub-path for. Which of them a plugin
// really has is the descriptor's decision; a tab the plugin lacks is Not Found.
export type RepositoryTab =
  'versions' | 'distributions' | 'publications' | 'content' | 'packages';

// The kind of object a screen is about. The list of every plugin's
// distributions is about none: it belongs to no plugin.
export function resourceOf(screen: ScreenKind): ResourceKind | null {
  if (screen === 'distribution-list') {
    return null;
  }
  if (screen.startsWith('remote')) {
    return 'remote';
  }

  return screen.startsWith('distribution') ? 'distribution' : 'repository';
}

const EVERY_KIND: readonly ResourceKind[] = [
  'repository',
  'remote',
  'distribution',
];

export interface FrameworkPattern {
  // The route path, with :parameters, relative to the application root.
  pattern: string;
  screen: ScreenKind;
  // For a tab pattern, the tab it shows.
  tab?: RepositoryTab;
}

// The addresses of a plugin's screens for the given kinds of object, all of
// them when none are given. Create lives beside the name namespace and not
// inside it, so no repository, remote or distribution name is shadowed by a
// literal segment.
export function patternsOf(
  plugin: FrameworkPlugin,
  resources: readonly ResourceKind[] = EVERY_KIND,
): FrameworkPattern[] {
  const repositories = `/${plugin}/repositories`;
  const remotes = `/${plugin}/remotes`;
  const distributions = `/${plugin}/distributions`;

  const all: FrameworkPattern[] = [
    { pattern: repositories, screen: 'repository-list' },
    { pattern: `${repositories}/:name`, screen: 'repository-detail' },
    {
      pattern: `${repositories}/:name/versions`,
      screen: 'repository-tab',
      tab: 'versions',
    },
    {
      pattern: `${repositories}/:name/versions/:number`,
      screen: 'repository-tab',
      tab: 'versions',
    },
    {
      pattern: `${repositories}/:name/distributions`,
      screen: 'repository-tab',
      tab: 'distributions',
    },
    {
      pattern: `${repositories}/:name/publications`,
      screen: 'repository-tab',
      tab: 'publications',
    },
    {
      pattern: `${repositories}/:name/content`,
      screen: 'repository-tab',
      tab: 'content',
    },
    {
      pattern: `${repositories}/:name/packages`,
      screen: 'repository-tab',
      tab: 'packages',
    },
    { pattern: `${repositories}/:name/edit`, screen: 'repository-edit' },
    { pattern: `/${plugin}/repository/new`, screen: 'repository-create' },
    { pattern: remotes, screen: 'remote-list' },
    { pattern: `${remotes}/:name`, screen: 'remote-detail' },
    { pattern: `${remotes}/:name/edit`, screen: 'remote-edit' },
    { pattern: `/${plugin}/remote/new`, screen: 'remote-create' },
    { pattern: `${distributions}/:name`, screen: 'distribution-detail' },
    { pattern: `${distributions}/:name/edit`, screen: 'distribution-edit' },
    { pattern: `/${plugin}/distribution/new`, screen: 'distribution-create' },
  ];

  return all.filter(({ screen }) =>
    resources.includes(resourceOf(screen) as ResourceKind),
  );
}

// The addresses that belong to no plugin: the screens that list objects of
// every plugin at once.
export function corePatterns(): FrameworkPattern[] {
  return [{ pattern: '/distributions', screen: 'distribution-list' }];
}

export interface LegacyPattern {
  // The address that existed before the screens moved onto the framework.
  pattern: string;
  screen: ScreenKind;
}

// The addresses the screens had before they were named by their object. Each
// one moves to its new address. `edit/_` was the create address. Only the kinds
// of object the plugin has screens for on the framework are listed: a plugin
// that keeps its own screens for the rest keeps their addresses.
export function legacyPatternsOf(
  plugin: FrameworkPlugin,
  resources: readonly ResourceKind[] = ['repository', 'remote'],
): LegacyPattern[] {
  const repositories = `/${plugin}/repositories`;
  const remotes = `/${plugin}/remotes`;

  const all: LegacyPattern[] = [
    { pattern: `${repositories}/detail/:name`, screen: 'repository-detail' },
    { pattern: `${repositories}/edit/:name`, screen: 'repository-edit' },
    { pattern: `${repositories}/edit/_`, screen: 'repository-create' },
    { pattern: `${remotes}/detail/:name`, screen: 'remote-detail' },
    { pattern: `${remotes}/edit/:name`, screen: 'remote-edit' },
    { pattern: `${remotes}/edit/_`, screen: 'remote-create' },
  ];

  return all.filter(({ screen }) =>
    resources.includes(resourceOf(screen) as ResourceKind),
  );
}

// The list of the distributions of every plugin.
export const distributionListPath = () => fillPath('/distributions');

// The address of one distribution of a plugin, its edit form and the form that
// creates one. A name is encoded into a single segment, and create lives
// outside the name namespace.
export const distributionPath = (plugin: FrameworkPlugin, name: string) =>
  fillPath(`/${plugin}/distributions/:name`, { name });

export const distributionEditPath = (plugin: FrameworkPlugin, name: string) =>
  fillPath(`/${plugin}/distributions/:name/edit`, { name });

// The create form takes the repository to serve as a query parameter, so a form
// opened from a repository starts with it chosen.
export const newDistributionPath = (
  plugin: FrameworkPlugin,
  repository?: string,
) =>
  `${fillPath(`/${plugin}/distribution/new`)}${
    repository === undefined
      ? ''
      : `?repository=${encodeURIComponent(repository)}`
  }`;

// The address of one object. A name is encoded into a single segment; a
// version number is spelled as a string because 0 is a version too, and the
// formatter treats a falsy value as missing.
export const repositoryListPath = (plugin: FrameworkPlugin) =>
  fillPath(`/${plugin}/repositories`);

export const repositoryPath = (
  plugin: FrameworkPlugin,
  name: string,
  tab?: RepositoryTab,
) => fillPath(`/${plugin}/repositories/:name${tab ? `/${tab}` : ''}`, { name });

export const versionPath = (
  plugin: FrameworkPlugin,
  name: string,
  number: number,
) =>
  fillPath(`/${plugin}/repositories/:name/versions/:number`, {
    name,
    number: String(number),
  });

export const repositoryEditPath = (plugin: FrameworkPlugin, name: string) =>
  fillPath(`/${plugin}/repositories/:name/edit`, { name });

export const newRepositoryPath = (plugin: FrameworkPlugin) =>
  fillPath(`/${plugin}/repository/new`);

export const remoteListPath = (plugin: FrameworkPlugin) =>
  fillPath(`/${plugin}/remotes`);

export const remotePath = (plugin: FrameworkPlugin, name: string) =>
  fillPath(`/${plugin}/remotes/:name`, { name });

export const remoteEditPath = (plugin: FrameworkPlugin, name: string) =>
  fillPath(`/${plugin}/remotes/:name/edit`, { name });

export const newRemotePath = (plugin: FrameworkPlugin) =>
  fillPath(`/${plugin}/remote/new`);
