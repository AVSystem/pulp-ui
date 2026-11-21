import {
  distributionsPythonPypiCreate,
  distributionsPythonPypiDelete,
  distributionsPythonPypiList,
  distributionsPythonPypiPartialUpdate,
  distributionsPythonPypiRead,
  getDistributionsPythonPypiListUrl,
} from '@pulp-ui/sdk/python/distributions-pypi';
import { makeDistributionEntity } from 'src/entities/plugin/distribution';
import {
  type PythonDistributionChanges,
  pythonDistributionSchema,
} from './model';

// The python plugin's distributions: its generated functions and its schema
// are all that differs from any other plugin. A change is typed to the two
// fields a screen edits, the pull-through remote and the upload permission.
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
      body: PythonDistributionChanges,
      options?: Parameters<typeof distributionsPythonPypiPartialUpdate>[2],
    ) => distributionsPythonPypiPartialUpdate(href, body, options),
    remove: distributionsPythonPypiDelete,
  },
});
