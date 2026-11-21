import {
  getRemotesPythonPythonListUrl,
  remotesPythonPythonCreate,
  remotesPythonPythonDelete,
  remotesPythonPythonList,
  remotesPythonPythonPartialUpdate,
  remotesPythonPythonRead,
  remotesPythonPythonSetLabel,
  remotesPythonPythonUnsetLabel,
} from '@pulp-ui/sdk/python/remotes-python';
import { makeRemoteEntity } from 'src/entities/plugin/remote';
import { pythonRemoteSchema } from './model';

// The python plugin's remotes: its generated functions and its schema are all
// that differs from any other plugin.
export const pythonRemote = makeRemoteEntity({
  app: 'python',
  schema: pythonRemoteSchema,
  api: {
    list: remotesPythonPythonList,
    listUrl: getRemotesPythonPythonListUrl,
    read: remotesPythonPythonRead,
    create: remotesPythonPythonCreate,
    partialUpdate: remotesPythonPythonPartialUpdate,
    remove: remotesPythonPythonDelete,
    setLabel: remotesPythonPythonSetLabel,
    unsetLabel: remotesPythonPythonUnsetLabel,
  },
});
