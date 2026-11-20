import {
  getRepositoriesFileFileListUrl,
  repositoriesFileFileCreate,
  repositoriesFileFileDelete,
  repositoriesFileFileList,
  repositoriesFileFileModify,
  repositoriesFileFilePartialUpdate,
  repositoriesFileFileRead,
  repositoriesFileFileSetLabel,
  repositoriesFileFileSync,
  repositoriesFileFileUnsetLabel,
} from '@pulp-ui/sdk/file/repositories-file';
import {
  repositoriesFileFileVersionsList,
  repositoriesFileFileVersionsRead,
} from '@pulp-ui/sdk/file/repositories-file-versions';
import { makeRepositoryEntity } from 'src/entities/plugin/repository';
import { fileRepositorySchema } from './model';

// The file plugin's repositories: its generated functions and its schema are
// all that differs from any other plugin.
export const fileRepository = makeRepositoryEntity({
  app: 'file',
  schema: fileRepositorySchema,
  api: {
    list: repositoriesFileFileList,
    listUrl: getRepositoriesFileFileListUrl,
    read: repositoriesFileFileRead,
    create: repositoriesFileFileCreate,
    partialUpdate: repositoriesFileFilePartialUpdate,
    remove: repositoriesFileFileDelete,
    setLabel: repositoriesFileFileSetLabel,
    unsetLabel: repositoriesFileFileUnsetLabel,
    versionsList: repositoriesFileFileVersionsList,
    versionRead: repositoriesFileFileVersionsRead,
    sync: repositoriesFileFileSync,
    modify: repositoriesFileFileModify,
  },
});
