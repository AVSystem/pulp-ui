import type { ComponentType, ElementType, ReactElement } from 'react';
import { lazyScreen } from 'src/components/lazy-screen';
import type { PluginDescriptor } from './descriptor';
import type { FrameworkPlugin, PluginManifest } from './manifest';
import {
  type FrameworkPattern,
  type RepositoryTab,
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
      return repositoryDetailScreen(plugin, tab as RepositoryTab);
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

    return patternsOf(plugin)
      .filter(({ screen }) =>
        resources.includes(
          screen.startsWith('remote') ? 'remote' : 'repository',
        ),
      )
      .flatMap((pattern) => {
        const component = componentOf(plugin, pattern);

        return component ? [{ component, path: pattern.pattern, plugin }] : [];
      });
  });
}
