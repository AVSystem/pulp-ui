import type { ComponentType, ElementType } from 'react';
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
};

// The list of a plugin's repositories, drawn by the generic screen from the
// plugin's descriptor.
function repositoryListScreen(plugin: FrameworkPlugin): ComponentType {
  const loadDescriptor = DESCRIPTORS[plugin] as NonNullable<
    (typeof DESCRIPTORS)[FrameworkPlugin]
  >;

  return lazyScreen(async () => {
    const [{ default: descriptor }, { RepositoryList }] = await Promise.all([
      loadDescriptor(),
      import(
        /* webpackChunkName: "framework" */ 'src/framework/list/repository-list'
      ),
    ]);

    return {
      default: () => <RepositoryList plugin={plugin} descriptor={descriptor} />,
    };
  });
}

// The detail of a repository on one of its tabs, drawn by the generic screen
// from the plugin's descriptor. The generic code is a chunk shared by every
// plugin.
function repositoryDetailScreen(
  plugin: FrameworkPlugin,
  tab: RepositoryTab | null,
): ComponentType {
  const loadDescriptor = DESCRIPTORS[plugin] as NonNullable<
    (typeof DESCRIPTORS)[FrameworkPlugin]
  >;

  return lazyScreen(async () => {
    const [{ default: descriptor }, { RepositoryDetail }] = await Promise.all([
      loadDescriptor(),
      import(
        /* webpackChunkName: "framework" */ 'src/framework/detail/repository-detail'
      ),
    ]);

    return {
      default: () => (
        <RepositoryDetail plugin={plugin} descriptor={descriptor} tab={tab} />
      ),
    };
  });
}

// The edit form of a repository, drawn by the generic screen from the plugin's
// descriptor.
function repositoryEditScreen(plugin: FrameworkPlugin): ComponentType {
  const loadDescriptor = DESCRIPTORS[plugin] as NonNullable<
    (typeof DESCRIPTORS)[FrameworkPlugin]
  >;

  return lazyScreen(async () => {
    const [{ default: descriptor }, { RepositoryEdit }] = await Promise.all([
      loadDescriptor(),
      import(
        /* webpackChunkName: "framework" */ 'src/framework/form/repository-edit'
      ),
    ]);

    return {
      default: () => <RepositoryEdit plugin={plugin} descriptor={descriptor} />,
    };
  });
}

// The create form of a repository, drawn by the generic screen from the
// plugin's descriptor.
function repositoryCreateScreen(plugin: FrameworkPlugin): ComponentType {
  const loadDescriptor = DESCRIPTORS[plugin] as NonNullable<
    (typeof DESCRIPTORS)[FrameworkPlugin]
  >;

  return lazyScreen(async () => {
    const [{ default: descriptor }, { RepositoryCreate }] = await Promise.all([
      loadDescriptor(),
      import(
        /* webpackChunkName: "framework" */ 'src/framework/form/repository-create'
      ),
    ]);

    return {
      default: () => (
        <RepositoryCreate plugin={plugin} descriptor={descriptor} />
      ),
    };
  });
}

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
