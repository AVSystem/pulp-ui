import {
  getRepositoriesPythonPythonListUrl,
  repositoriesPythonPythonCreate,
  repositoriesPythonPythonDelete,
  repositoriesPythonPythonList,
  repositoriesPythonPythonModify,
  repositoriesPythonPythonPartialUpdate,
  repositoriesPythonPythonRead,
  repositoriesPythonPythonSetLabel,
  repositoriesPythonPythonSync,
  repositoriesPythonPythonUnsetLabel,
} from '@pulp-ui/sdk/python/repositories-python';
import {
  repositoriesPythonPythonVersionsDelete,
  repositoriesPythonPythonVersionsList,
  repositoriesPythonPythonVersionsRead,
} from '@pulp-ui/sdk/python/repositories-python-versions';
import { makeRepositoryEntity } from 'src/entities/plugin/repository';
import { pythonRepositorySchema } from './model';

// The python plugin's repositories: its generated functions and its schema are
// all that differs from any other plugin.
export const pythonRepository = makeRepositoryEntity({
  app: 'python',
  schema: pythonRepositorySchema,
  api: {
    list: repositoriesPythonPythonList,
    listUrl: getRepositoriesPythonPythonListUrl,
    read: repositoriesPythonPythonRead,
    create: repositoriesPythonPythonCreate,
    partialUpdate: repositoriesPythonPythonPartialUpdate,
    remove: repositoriesPythonPythonDelete,
    setLabel: repositoriesPythonPythonSetLabel,
    unsetLabel: repositoriesPythonPythonUnsetLabel,
    versionsList: repositoriesPythonPythonVersionsList,
    versionRead: repositoriesPythonPythonVersionsRead,
    versionDelete: repositoriesPythonPythonVersionsDelete,
    sync: repositoriesPythonPythonSync,
    modify: repositoriesPythonPythonModify,
  },
});
