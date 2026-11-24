import { useQuery } from '@tanstack/react-query';
import type { PluginDescriptor } from '../descriptor';

// The descriptors of the plugins that publish, each in the chunk of its own
// plugin. A screen that has no descriptor at hand (the list of the
// distributions of every plugin) loads the one it needs when the user asks to
// publish, and the chunk is the one the plugin's own screens use.
const LOADERS: Record<string, () => Promise<{ default: PluginDescriptor }>> = {
  file: () =>
    import(/* webpackChunkName: "file" */ 'src/descriptors/file/descriptor'),
  deb: () =>
    import(/* webpackChunkName: "deb" */ 'src/descriptors/deb/descriptor'),
  rpm: () =>
    import(/* webpackChunkName: "rpm" */ 'src/descriptors/rpm/descriptor'),
};

// The descriptor of a plugin that publishes, read once and kept.
export function usePublishDescriptor(plugin: string) {
  return useQuery({
    queryKey: ['framework', 'descriptor', plugin],
    queryFn: async () => {
      const load = LOADERS[plugin];
      if (!load) {
        throw new Error(`The ${plugin} plugin has no publications to make`);
      }
      return (await load()).default;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}
