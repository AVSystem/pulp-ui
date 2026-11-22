import {
  distributionsNpmNpmCreate,
  distributionsNpmNpmDelete,
  distributionsNpmNpmList,
  distributionsNpmNpmPartialUpdate,
  distributionsNpmNpmRead,
  distributionsNpmNpmSetLabel,
  distributionsNpmNpmUnsetLabel,
  getDistributionsNpmNpmListUrl,
} from '@pulp-ui/sdk/npm/distributions-npm';
import {
  distributionSchema,
  makeDistributionEntity,
} from 'src/entities/plugin/distribution';

// The npm plugin's distributions: its generated functions are all that
// differs from any other plugin.
export const npmDistribution = makeDistributionEntity({
  app: 'npm',
  schema: distributionSchema,
  api: {
    list: distributionsNpmNpmList,
    listUrl: getDistributionsNpmNpmListUrl,
    read: distributionsNpmNpmRead,
    create: distributionsNpmNpmCreate,
    partialUpdate: distributionsNpmNpmPartialUpdate,
    remove: distributionsNpmNpmDelete,
    setLabel: distributionsNpmNpmSetLabel,
    unsetLabel: distributionsNpmNpmUnsetLabel,
  },
});
