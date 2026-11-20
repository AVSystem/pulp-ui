import {
  getRemotesFileFileListUrl,
  remotesFileFileCreate,
  remotesFileFileDelete,
  remotesFileFileList,
  remotesFileFilePartialUpdate,
  remotesFileFileRead,
  remotesFileFileSetLabel,
  remotesFileFileUnsetLabel,
} from '@pulp-ui/sdk/file/remotes-file';
import { makeRemoteEntity } from 'src/entities/plugin/remote';
import { fileRemoteSchema } from './model';

// The file plugin's remotes: its generated functions and its schema are all
// that differs from any other plugin.
export const fileRemote = makeRemoteEntity({
  app: 'file',
  schema: fileRemoteSchema,
  api: {
    list: remotesFileFileList,
    listUrl: getRemotesFileFileListUrl,
    read: remotesFileFileRead,
    create: remotesFileFileCreate,
    partialUpdate: remotesFileFilePartialUpdate,
    remove: remotesFileFileDelete,
    setLabel: remotesFileFileSetLabel,
    unsetLabel: remotesFileFileUnsetLabel,
  },
});
