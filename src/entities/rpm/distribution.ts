import {
  distributionsRpmRpmCreate,
  distributionsRpmRpmDelete,
  distributionsRpmRpmList,
  distributionsRpmRpmPartialUpdate,
  distributionsRpmRpmRead,
  distributionsRpmRpmSetLabel,
  distributionsRpmRpmUnsetLabel,
  getDistributionsRpmRpmListUrl,
} from '@pulp-ui/sdk/rpm/distributions-rpm';
import {
  distributionSchema,
  makeDistributionEntity,
} from 'src/entities/plugin/distribution';

// The rpm plugin's distributions: its generated functions are all that differs
// from any other plugin.
export const rpmDistribution = makeDistributionEntity({
  app: 'rpm',
  schema: distributionSchema,
  api: {
    list: distributionsRpmRpmList,
    listUrl: getDistributionsRpmRpmListUrl,
    read: distributionsRpmRpmRead,
    create: distributionsRpmRpmCreate,
    partialUpdate: distributionsRpmRpmPartialUpdate,
    remove: distributionsRpmRpmDelete,
    setLabel: distributionsRpmRpmSetLabel,
    unsetLabel: distributionsRpmRpmUnsetLabel,
  },
});
