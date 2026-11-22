import type { ComponentType, ElementType, ReactElement } from 'react';
import { lazyScreen } from 'src/components/lazy-screen';
import type { PluginDescriptor } from './descriptor';
import type { FrameworkPlugin, PluginManifest } from './manifest';
import {
  type FrameworkPattern,
  type RepositoryTab,
  corePatterns,
  patternsOf,
} from './route-patterns';

// The route of a screen the framework draws, in the shape the application's
// route table has: `plugin` is the component name the plugin gate compares with
// the installed plugins, so a plugin the server lacks shows "not installed" and
// loads nothing.
export interface FrameworkRoute {
  component: ElementType;
  path: string;
  plugin: string;
}

// Each plugin's descriptor is a chunk of its own, named after the plugin, that
// loads when one of the plugin's screens is first shown. The entry chunk holds
// only these loaders, the manifests and the route patterns.
const DESCRIPTORS: Partial<
  Record<FrameworkPlugin, () => Promise<{ default: PluginDescriptor }>>
> = {
  file: () =>
    import(/* webpackChunkName: "file" */ 'src/descriptors/file/descriptor'),
  deb: () =>
    import(/* webpackChunkName: "deb" */ 'src/descriptors/deb/descriptor'),
  rpm: () =>
    import(/* webpackChunkName: "rpm" */ 'src/descriptors/rpm/descriptor'),
  python: () =>
    import(
      /* webpackChunkName: "python" */ 'src/descriptors/python/descriptor'
    ),
  maven: () =>
    import(/* webpackChunkName: "maven" */ 'src/descriptors/maven/descriptor'),
  npm: () =>
    import(/* webpackChunkName: "npm" */ 'src/descriptors/npm/descriptor'),
  ansible: () =>
    import(
      /* webpackChunkName: "ansible-framework" */ 'src/descriptors/ansible/descriptor'
    ),
  container: () =>
    import(
      /* webpackChunkName: "container" */ 'src/descriptors/container/descriptor'
    ),
};

// A screen drawn by generic code from a plugin's descriptor: the descriptor
// (the plugin's own chunk) and the generic screen (a chunk shared by every
// plugin) load together when the screen is first shown.
function descriptorScreen<Module>(
  plugin: FrameworkPlugin,
  loadScreen: () => Promise<Module>,
  draw: (module: Module, descriptor: PluginDescriptor) => ReactElement,
): ComponentType {
  const loadDescriptor = DESCRIPTORS[plugin] as NonNullable<
    (typeof DESCRIPTORS)[FrameworkPlugin]
  >;

  return lazyScreen(async () => {
    const [{ default: descriptor }, module] = await Promise.all([
      loadDescriptor(),
      loadScreen(),
    ]);

    return { default: () => draw(module, descriptor) };
  });
}

// The list of a plugin's repositories.
const repositoryListScreen = (plugin: FrameworkPlugin) =>
  descriptorScreen(
    plugin,
    () =>
      import(
        /* webpackChunkName: "framework" */ 'src/framework/list/repository-list'
      ),
    ({ RepositoryList }, descriptor) => (
      <RepositoryList plugin={plugin} descriptor={descriptor} />
    ),
  );

// The detail of a repository on one of its tabs.
const repositoryDetailScreen = (
  plugin: FrameworkPlugin,
  tab: RepositoryTab | null,
) =>
  descriptorScreen(
    plugin,
    () =>
      import(
        /* webpackChunkName: "framework" */ 'src/framework/detail/repository-detail'
      ),
    ({ RepositoryDetail }, descriptor) => (
      <RepositoryDetail plugin={plugin} descriptor={descriptor} tab={tab} />
    ),
  );

// The edit form of a repository.
const repositoryEditScreen = (plugin: FrameworkPlugin) =>
  descriptorScreen(
    plugin,
    () =>
      import(
        /* webpackChunkName: "framework" */ 'src/framework/form/repository-edit'
      ),
    ({ RepositoryEdit }, descriptor) => (
      <RepositoryEdit plugin={plugin} descriptor={descriptor} />
    ),
  );

// The create form of a repository.
const repositoryCreateScreen = (plugin: FrameworkPlugin) =>
  descriptorScreen(
    plugin,
    () =>
      import(
        /* webpackChunkName: "framework" */ 'src/framework/form/repository-create'
      ),
    ({ RepositoryCreate }, descriptor) => (
      <RepositoryCreate plugin={plugin} descriptor={descriptor} />
    ),
  );

// The detail of a remote.
const remoteDetailScreen = (plugin: FrameworkPlugin) =>
  descriptorScreen(
    plugin,
    () =>
      import(
        /* webpackChunkName: "framework" */ 'src/framework/detail/remote-detail'
      ),
    ({ RemoteDetail }, descriptor) => (
      <RemoteDetail plugin={plugin} descriptor={descriptor} />
    ),
  );

// The list of a plugin's remotes.
const remoteListScreen = (plugin: FrameworkPlugin) =>
  descriptorScreen(
    plugin,
    () =>
      import(
        /* webpackChunkName: "framework" */ 'src/framework/list/remote-list'
      ),
    ({ RemoteList }, descriptor) => (
      <RemoteList plugin={plugin} descriptor={descriptor} />
    ),
  );

// The edit form of a remote.
const remoteEditScreen = (plugin: FrameworkPlugin) =>
  descriptorScreen(
    plugin,
    () =>
      import(
        /* webpackChunkName: "framework" */ 'src/framework/form/remote-form'
      ),
    ({ RemoteEdit }, descriptor) => (
      <RemoteEdit plugin={plugin} descriptor={descriptor} />
    ),
  );

// The create form of a remote.
const remoteCreateScreen = (plugin: FrameworkPlugin) =>
  descriptorScreen(
    plugin,
    () =>
      import(
        /* webpackChunkName: "framework" */ 'src/framework/form/remote-form'
      ),
    ({ RemoteCreate }, descriptor) => (
      <RemoteCreate plugin={plugin} descriptor={descriptor} />
    ),
  );

// The list of the distributions of every installed plugin. It belongs to no
// plugin, so it is one screen and not one per descriptor.
const DistributionListScreen = lazyScreen(() =>
  import(
    /* webpackChunkName: "framework" */ 'src/framework/distributions/distribution-list'
  ).then(({ DistributionList }) => ({ default: DistributionList })),
);

// The tabs of a repository that have a screen. The address of any other tab is
// reserved and answers Not Found without a read, like any address without a
// route.
const TABS_WITH_SCREENS: ReadonlySet<RepositoryTab> = new Set<RepositoryTab>([
  'versions',
  'distributions',
  'packages',
]);

// The component of a pattern, or null while its screen does not exist yet:
// such a pattern is not routed.
function componentOf(
  plugin: FrameworkPlugin,
  { screen, tab }: FrameworkPattern,
): ComponentType | null {
  switch (screen) {
    case 'repository-list':
      return repositoryListScreen(plugin);
    case 'repository-detail':
      return repositoryDetailScreen(plugin, null);
    case 'repository-tab':
      return TABS_WITH_SCREENS.has(tab as RepositoryTab)
        ? repositoryDetailScreen(plugin, tab as RepositoryTab)
        : null;
    case 'repository-edit':
      return repositoryEditScreen(plugin);
    case 'repository-create':
      return repositoryCreateScreen(plugin);
    case 'remote-list':
      return remoteListScreen(plugin);
    case 'remote-detail':
      return remoteDetailScreen(plugin);
    case 'remote-edit':
      return remoteEditScreen(plugin);
    case 'remote-create':
      return remoteCreateScreen(plugin);
    default:
      return null;
  }
}

// The routes of the given plugins' screens. The caller passes the plugins that
// are on the framework; a plugin that is not on it keeps its own routes.
export function frameworkRoutes(
  manifests: readonly PluginManifest[],
): FrameworkRoute[] {
  return manifests.flatMap(({ plugin, resources }) => {
    if (!DESCRIPTORS[plugin]) {
      throw new Error(
        `The ${plugin} plugin is on the framework but has no descriptor`,
      );
    }

    return patternsOf(plugin, resources).flatMap((pattern) => {
      const component = componentOf(plugin, pattern);

      return component ? [{ component, path: pattern.pattern, plugin }] : [];
    });
  });
}

// The route of a screen that belongs to no plugin, in the shape the
// application's route table has. It passes no plugin gate: the screen itself
// reads which plugins are installed.
export type FrameworkCoreRoute = Omit<FrameworkRoute, 'plugin'>;

// The routes of the screens that list the objects of every plugin at once. A
// pattern whose screen does not exist yet is not routed.
export function frameworkCoreRoutes(): FrameworkCoreRoute[] {
  return corePatterns().flatMap(({ pattern, screen }) =>
    screen === 'distribution-list'
      ? [{ component: DistributionListScreen, path: pattern }]
      : [],
  );
}
