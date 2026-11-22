import {
  distributionsMavenMavenCreate,
  distributionsMavenMavenDelete,
  distributionsMavenMavenList,
  distributionsMavenMavenPartialUpdate,
  distributionsMavenMavenRead,
  distributionsMavenMavenSetLabel,
  distributionsMavenMavenUnsetLabel,
  getDistributionsMavenMavenListUrl,
} from '@pulp-ui/sdk/maven/distributions-maven';
import {
  distributionSchema,
  makeDistributionEntity,
} from 'src/entities/plugin/distribution';

// The maven plugin's distributions: its generated functions are all that
// differs from any other plugin.
export const mavenDistribution = makeDistributionEntity({
  app: 'maven',
  schema: distributionSchema,
  api: {
    list: distributionsMavenMavenList,
    listUrl: getDistributionsMavenMavenListUrl,
    read: distributionsMavenMavenRead,
    create: distributionsMavenMavenCreate,
    partialUpdate: distributionsMavenMavenPartialUpdate,
    remove: distributionsMavenMavenDelete,
    setLabel: distributionsMavenMavenSetLabel,
    unsetLabel: distributionsMavenMavenUnsetLabel,
  },
});
