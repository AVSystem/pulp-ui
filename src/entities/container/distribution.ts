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
import { z } from 'zod';
import {
  distributionSchema,
  makeDistributionEntity,
} from 'src/entities/plugin/distribution';

// A container distribution is reached through the registry path the plugin
// reports, the host and the base path a client pulls from. It has no content
// address, which every other plugin's distribution reports as its base URL.
const containerDistributionSchema = distributionSchema.extend({
  registry_path: z.string().nullish(),
});

// The container plugin's distributions: its generated functions and the address
// a client uses are all that differ from any other plugin. The plugin attaches
// its own redirect guard to a distribution created without one and refuses an
// explicit "no guard".
export const containerDistribution = makeDistributionEntity({
  app: 'container',
  schema: containerDistributionSchema,
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
  clientUrl: (row) => row.registry_path,
  urlFields: ['registry_path'],
});
