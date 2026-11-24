import { useAppContext } from 'src/app-context';
import type { PluginDescriptor } from '../descriptor';
import { type FrameworkPlugin, PLUGIN_MANIFESTS } from '../manifest';

// Whether the user holds the plugin's add publication permission. It is read
// as held on every object only: an object role on the repository does not
// grant a publish, and Pulp decides every request.
export function usePublishPermission(plugin: FrameworkPlugin): boolean {
  const { hasPermission } = useAppContext();
  const name = PLUGIN_MANIFESTS.find((candidate) => candidate.plugin === plugin)
    ?.permissions.publication?.add;

  return name !== undefined && hasPermission(name);
}

// Whether Publish is offered for a plugin's repositories: the plugin publishes
// from the screens and the user holds the add publication permission.
export function useMayPublish(
  plugin: FrameworkPlugin,
  descriptor: PluginDescriptor,
): boolean {
  const permitted = usePublishPermission(plugin);

  return descriptor.publication?.entity.create !== undefined && permitted;
}
