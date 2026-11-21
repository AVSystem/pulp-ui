import {
  distributionsDebAptCreate,
  distributionsDebAptDelete,
  distributionsDebAptList,
  distributionsDebAptPartialUpdate,
  distributionsDebAptRead,
  getDistributionsDebAptListUrl,
} from '@pulp-ui/sdk/deb/distributions-apt';
import {
  distributionSchema,
  makeDistributionEntity,
} from 'src/entities/plugin/distribution';

// The deb plugin's distributions: its generated functions are all that differs
// from any other plugin.
export const debDistribution = makeDistributionEntity({
  app: 'deb',
  schema: distributionSchema,
  api: {
    list: distributionsDebAptList,
    listUrl: getDistributionsDebAptListUrl,
    read: distributionsDebAptRead,
    create: distributionsDebAptCreate,
    partialUpdate: distributionsDebAptPartialUpdate,
    remove: distributionsDebAptDelete,
  },
});
