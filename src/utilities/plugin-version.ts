import { t } from '@lingui/core/macro';
import { PulpStatusAPI } from '../api/pulp-status';

interface PluginVersion {
  name: string;
  version: string;
}

const cache: { promise: Promise<unknown> | null; time: number } = {
  promise: null,
  time: 0,
};

// Keeps one answer for 5 minutes and hands it to every caller meanwhile. A
// failed answer is dropped as soon as it fails, so the next call asks the
// server again instead of repeating the failure. fresh skips the cached answer.
const cached = (fn: () => Promise<unknown>, fresh = false) => {
  if (fresh || !cache.promise || cache.time + 300000 < Date.now()) {
    cache.time = Date.now();
    const promise = fn().catch((error) => {
      // A newer request may have replaced this one already.
      if (cache.promise === promise) {
        cache.promise = null;
      }
      throw error;
    });
    cache.promise = promise;
  }

  return cache.promise;
};

// Forgets the cached answer, so the next call asks the server again.
export function resetPluginVersionsCache() {
  cache.promise = null;
  cache.time = 0;
}

// An answer that holds no list of versions (the reduced answer a server gives
// to a visitor who is not signed in) is a failed read. It is rejected inside
// the cached read, so it is dropped from the cache like any other failure.
const readStatus = () =>
  PulpStatusAPI.get().then((response: { data }) => {
    if (!Array.isArray(response.data?.versions)) {
      throw new Error(t`The status answer lists no plugins.`);
    }
    return response;
  });

export function plugin_versions({
  fresh = false,
}: { fresh?: boolean } = {}): Promise<PluginVersion[]> {
  return cached(readStatus, fresh).then(({ data }: { data }) =>
    data.versions.map(({ component, version }) => ({
      name: component,
      version: version,
    })),
  );
}
