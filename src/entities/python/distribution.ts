import {
  distributionsPythonPypiCreate,
  distributionsPythonPypiDelete,
  distributionsPythonPypiList,
  distributionsPythonPypiPartialUpdate,
  distributionsPythonPypiRead,
  distributionsPythonPypiSetLabel,
  distributionsPythonPypiUnsetLabel,
  getDistributionsPythonPypiListUrl,
} from '@pulp-ui/sdk/python/distributions-pypi';
import {
  type DistributionChanges,
  makeDistributionEntity,
} from 'src/entities/plugin/distribution';
import {
  type PythonDistributionChanges,
  pythonDistributionSchema,
} from './model';

// The python plugin's distributions: its generated functions and its schema
// are all that differs from any other plugin.
export const pythonDistribution = makeDistributionEntity({
  app: 'python',
  schema: pythonDistributionSchema,
  api: {
    list: distributionsPythonPypiList,
    listUrl: getDistributionsPythonPypiListUrl,
    read: distributionsPythonPypiRead,
    create: distributionsPythonPypiCreate,
    partialUpdate: (
      href: string,
      body: PythonDistributionChanges | DistributionChanges,
      options?: Parameters<typeof distributionsPythonPypiPartialUpdate>[2],
    ) => distributionsPythonPypiPartialUpdate(href, body, options),
    remove: distributionsPythonPypiDelete,
    setLabel: distributionsPythonPypiSetLabel,
    unsetLabel: distributionsPythonPypiUnsetLabel,
  },
});
