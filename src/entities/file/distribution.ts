import {
  distributionsFileFileCreate,
  distributionsFileFileDelete,
  distributionsFileFileList,
  distributionsFileFilePartialUpdate,
  distributionsFileFileRead,
  distributionsFileFileSetLabel,
  distributionsFileFileUnsetLabel,
  getDistributionsFileFileListUrl,
} from '@pulp-ui/sdk/file/distributions-file';
import {
  distributionSchema,
  makeDistributionEntity,
} from 'src/entities/plugin/distribution';

// The file plugin's distributions: its generated functions are all that
// differs from any other plugin.
export const fileDistribution = makeDistributionEntity({
  app: 'file',
  schema: distributionSchema,
  api: {
    list: distributionsFileFileList,
    listUrl: getDistributionsFileFileListUrl,
    read: distributionsFileFileRead,
    create: distributionsFileFileCreate,
    partialUpdate: distributionsFileFilePartialUpdate,
    remove: distributionsFileFileDelete,
    setLabel: distributionsFileFileSetLabel,
    unsetLabel: distributionsFileFileUnsetLabel,
  },
});
