import {
  distributionsAnsibleAnsibleCreate,
  distributionsAnsibleAnsibleDelete,
  distributionsAnsibleAnsibleList,
  distributionsAnsibleAnsiblePartialUpdate,
  distributionsAnsibleAnsibleRead,
  distributionsAnsibleAnsibleSetLabel,
  distributionsAnsibleAnsibleUnsetLabel,
  getDistributionsAnsibleAnsibleListUrl,
} from '@pulp-ui/sdk/ansible/distributions-ansible';
import { z } from 'zod';
import {
  distributionSchema,
  makeDistributionEntity,
} from 'src/entities/plugin/distribution';

// An ansible distribution is reached through the collection source address the
// plugin reports as client_url. The base URL a distribution has in the
// cross-plugin list is the content app's address, which an ansible client does
// not use.
const ansibleDistributionSchema = distributionSchema.extend({
  client_url: z.string().nullish(),
});

// The ansible plugin's distributions: its generated functions are all that
// differs from any other plugin.
export const ansibleDistribution = makeDistributionEntity({
  app: 'ansible',
  schema: ansibleDistributionSchema,
  api: {
    list: distributionsAnsibleAnsibleList,
    listUrl: getDistributionsAnsibleAnsibleListUrl,
    read: distributionsAnsibleAnsibleRead,
    create: distributionsAnsibleAnsibleCreate,
    partialUpdate: distributionsAnsibleAnsiblePartialUpdate,
    remove: distributionsAnsibleAnsibleDelete,
    setLabel: distributionsAnsibleAnsibleSetLabel,
    unsetLabel: distributionsAnsibleAnsibleUnsetLabel,
  },
  clientUrl: (row) => row.client_url,
});
