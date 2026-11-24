import { useAppContext } from 'src/app-context';
import type { PluginDescriptor } from '../descriptor';
import { type FrameworkPlugin, PLUGIN_MANIFESTS } from '../manifest';

// Whether Publish is offered for a plugin's repositories: the plugin publishes
// from the screens and the user holds the plugin's add publication permission.
// The permission is read as held on every object only: an object role on the
// repository does not grant a publish, and Pulp decides every request.
export function useMayPublish(
  plugin: FrameworkPlugin,
  descriptor: PluginDescriptor,
): boolean {
  const { hasPermission } = useAppContext();
  const name = PLUGIN_MANIFESTS.find((candidate) => candidate.plugin === plugin)
    ?.permissions.publication?.add;

  return (
    descriptor.publication?.entity.create !== undefined &&
    name !== undefined &&
    hasPermission(name)
  );
}
