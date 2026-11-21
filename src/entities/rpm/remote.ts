import {
  getRemotesRpmRpmListUrl,
  remotesRpmRpmCreate,
  remotesRpmRpmDelete,
  remotesRpmRpmList,
  remotesRpmRpmPartialUpdate,
  remotesRpmRpmRead,
  remotesRpmRpmSetLabel,
  remotesRpmRpmUnsetLabel,
} from '@pulp-ui/sdk/rpm/remotes-rpm';
import { makeRemoteEntity } from 'src/entities/plugin/remote';
import { rpmRemoteSchema } from './model';

// The rpm plugin's remotes: its generated functions and its schema are all
// that differs from any other plugin.
export const rpmRemote = makeRemoteEntity({
  app: 'rpm',
  schema: rpmRemoteSchema,
  api: {
    list: remotesRpmRpmList,
    listUrl: getRemotesRpmRpmListUrl,
    read: remotesRpmRpmRead,
    create: remotesRpmRpmCreate,
    partialUpdate: remotesRpmRpmPartialUpdate,
    remove: remotesRpmRpmDelete,
    setLabel: remotesRpmRpmSetLabel,
    unsetLabel: remotesRpmRpmUnsetLabel,
  },
});
