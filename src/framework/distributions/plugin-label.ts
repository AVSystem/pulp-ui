import { t } from '@lingui/core/macro';
import type { DistributionPlugin } from 'src/entities/core/distribution/page';
import { PLUGIN_MANIFESTS } from '../manifest';

// The name a plugin is shown under in the distribution screens.
export function pluginLabel(plugin: DistributionPlugin): string {
  if (plugin === 'file') {
    return t`File`;
  }

  return (
    PLUGIN_MANIFESTS.find((manifest) => manifest.plugin === plugin)?.label ??
    plugin
  );
}
