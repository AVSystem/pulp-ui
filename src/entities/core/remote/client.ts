import { getRemotesListUrl, remotesList } from '@pulp-ui/sdk/core/remotes';
import { makeRemoteLookup } from 'src/entities/plugin/remote';

// The list of every plugin's remotes, which names a remote whatever its type.
export const remoteLookup = makeRemoteLookup({
  api: { list: remotesList, listUrl: getRemotesListUrl },
});
