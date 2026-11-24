import { ansibleDistribution } from 'src/entities/ansible/distribution';
import type { PluginDescriptor } from 'src/framework/descriptor';
import { ansibleSnippets } from './snippets';

// The ansible plugin's distributions as the framework reads them. Its repositories, remotes and collections keep their own screens. The descriptor
// and what it imports are one chunk that loads when a screen of the plugin's
// distributions is first shown.
const descriptor: PluginDescriptor = {
  distribution: { entity: ansibleDistribution, snippets: ansibleSnippets },
};

export default descriptor;
