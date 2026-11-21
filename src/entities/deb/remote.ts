import {
  getRemotesDebAptListUrl,
  remotesDebAptCreate,
  remotesDebAptDelete,
  remotesDebAptList,
  remotesDebAptPartialUpdate,
  remotesDebAptRead,
  remotesDebAptSetLabel,
  remotesDebAptUnsetLabel,
} from '@pulp-ui/sdk/deb/remotes-apt';
import { makeRemoteEntity } from 'src/entities/plugin/remote';
import { debRemoteSchema } from './model';

// The deb plugin's remotes: its generated functions and its schema are all
// that differs from any other plugin.
export const debRemote = makeRemoteEntity({
  app: 'deb',
  schema: debRemoteSchema,
  api: {
    list: remotesDebAptList,
    listUrl: getRemotesDebAptListUrl,
    read: remotesDebAptRead,
    create: remotesDebAptCreate,
    partialUpdate: remotesDebAptPartialUpdate,
    remove: remotesDebAptDelete,
    setLabel: remotesDebAptSetLabel,
    unsetLabel: remotesDebAptUnsetLabel,
  },
});
