import {
  getRepositoriesDebAptListUrl,
  repositoriesDebAptCreate,
  repositoriesDebAptDelete,
  repositoriesDebAptList,
  repositoriesDebAptModify,
  repositoriesDebAptPartialUpdate,
  repositoriesDebAptRead,
  repositoriesDebAptSetLabel,
  repositoriesDebAptSync,
  repositoriesDebAptUnsetLabel,
} from '@pulp-ui/sdk/deb/repositories-apt';
import {
  repositoriesDebAptVersionsDelete,
  repositoriesDebAptVersionsList,
  repositoriesDebAptVersionsRead,
} from '@pulp-ui/sdk/deb/repositories-apt-versions';
import { makeRepositoryEntity } from 'src/entities/plugin/repository';
import { debRepositorySchema } from './model';

// The deb plugin's repositories: its generated functions and its schema are
// all that differs from any other plugin.
export const debRepository = makeRepositoryEntity({
  app: 'deb',
  schema: debRepositorySchema,
  api: {
    list: repositoriesDebAptList,
    listUrl: getRepositoriesDebAptListUrl,
    read: repositoriesDebAptRead,
    create: repositoriesDebAptCreate,
    partialUpdate: repositoriesDebAptPartialUpdate,
    remove: repositoriesDebAptDelete,
    setLabel: repositoriesDebAptSetLabel,
    unsetLabel: repositoriesDebAptUnsetLabel,
    versionsList: repositoriesDebAptVersionsList,
    versionRead: repositoriesDebAptVersionsRead,
    versionDelete: repositoriesDebAptVersionsDelete,
    sync: repositoriesDebAptSync,
    modify: repositoriesDebAptModify,
  },
});
