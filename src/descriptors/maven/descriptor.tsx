import { mavenDistribution } from 'src/entities/maven/distribution';
import type { PluginDescriptor } from 'src/framework/descriptor';

// The maven plugin's distributions as the framework reads them. Its repositories and remotes have no screens on the framework. The descriptor
// and what it imports are one chunk that loads when a screen of the plugin's
// distributions is first shown.
const descriptor: PluginDescriptor = {
  distribution: { entity: mavenDistribution },
};

export default descriptor;
