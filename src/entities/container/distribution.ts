import {
  distributionsContainerContainerCreate,
  distributionsContainerContainerDelete,
  distributionsContainerContainerList,
  distributionsContainerContainerPartialUpdate,
  distributionsContainerContainerRead,
  distributionsContainerContainerSetLabel,
  distributionsContainerContainerUnsetLabel,
  getDistributionsContainerContainerListUrl,
} from '@pulp-ui/sdk/container/distributions-container';
import {
  distributionSchema,
  makeDistributionEntity,
} from 'src/entities/plugin/distribution';

// The container plugin's distributions: its generated functions are all that
// differs from any other plugin. The plugin attaches its own redirect guard to
// a distribution created without one and refuses an explicit "no guard".
export const containerDistribution = makeDistributionEntity({
  app: 'container',
  schema: distributionSchema,
  api: {
    list: distributionsContainerContainerList,
    listUrl: getDistributionsContainerContainerListUrl,
    read: distributionsContainerContainerRead,
    create: distributionsContainerContainerCreate,
    partialUpdate: distributionsContainerContainerPartialUpdate,
    remove: distributionsContainerContainerDelete,
    setLabel: distributionsContainerContainerSetLabel,
    unsetLabel: distributionsContainerContainerUnsetLabel,
  },
});
