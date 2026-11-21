import {
  getRepositoriesRpmRpmListUrl,
  repositoriesRpmRpmCreate,
  repositoriesRpmRpmDelete,
  repositoriesRpmRpmList,
  repositoriesRpmRpmModify,
  repositoriesRpmRpmPartialUpdate,
  repositoriesRpmRpmRead,
  repositoriesRpmRpmSetLabel,
  repositoriesRpmRpmSync,
  repositoriesRpmRpmUnsetLabel,
} from '@pulp-ui/sdk/rpm/repositories-rpm';
import {
  repositoriesRpmRpmVersionsList,
  repositoriesRpmRpmVersionsRead,
} from '@pulp-ui/sdk/rpm/repositories-rpm-versions';
import { makeRepositoryEntity } from 'src/entities/plugin/repository';
import { rpmRepositorySchema } from './model';

// The rpm plugin's repositories: its generated functions and its schema are
// all that differs from any other plugin.
export const rpmRepository = makeRepositoryEntity({
  app: 'rpm',
  schema: rpmRepositorySchema,
  api: {
    list: repositoriesRpmRpmList,
    listUrl: getRepositoriesRpmRpmListUrl,
    read: repositoriesRpmRpmRead,
    create: repositoriesRpmRpmCreate,
    partialUpdate: repositoriesRpmRpmPartialUpdate,
    remove: repositoriesRpmRpmDelete,
    setLabel: repositoriesRpmRpmSetLabel,
    unsetLabel: repositoriesRpmRpmUnsetLabel,
    versionsList: repositoriesRpmRpmVersionsList,
    versionRead: repositoriesRpmRpmVersionsRead,
    sync: repositoriesRpmRpmSync,
    modify: repositoriesRpmRpmModify,
  },
});
