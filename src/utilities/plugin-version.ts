import { t } from '@lingui/core/macro';
import { type QueryClient } from '@tanstack/react-query';
import { StatusClient } from 'src/entities/core/status/client';
import { statusKeys } from 'src/entities/core/status/queries';

interface PluginVersion {
  name: string;
  version: string;
}

// How long an answer is reused when nobody asks for a fresh one.
const REUSE_MS = 300000;

// Reads the installed plugins from the status answer. The answer is the one the
// Status screen shows: both read through the same query key of the given
// client, so opening the screen after the plugin list has loaded sends no
// second request, and callers that ask at the same time share one request. A
// failed answer is never kept, so the next call asks the server again. fresh
// skips an answer that is already held.
//
// An answer that holds no list of versions (the reduced answer a server gives
// to a visitor who is not signed in) is a failed read of the plugins. It stays
// a valid answer for the Status screen, so it is only marked out of date: the
// next call asks the server again instead of repeating the failure.
export async function plugin_versions({
  fresh = false,
  queryClient,
}: {
  fresh?: boolean;
  queryClient: QueryClient;
}): Promise<PluginVersion[]> {
  const answer = await queryClient.fetchQuery({
    queryKey: statusKeys.all,
    queryFn: ({ signal }) => StatusClient.retrieve({ signal }),
    staleTime: fresh ? 0 : REUSE_MS,
  });

  if (!Array.isArray(answer.versions)) {
    await queryClient.invalidateQueries({
      queryKey: statusKeys.all,
      refetchType: 'none',
    });
    throw new Error(t`The status answer lists no plugins.`);
  }

  return answer.versions.map(({ component, version }) => ({
    name: component,
    version,
  }));
}
