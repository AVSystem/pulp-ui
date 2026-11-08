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

export function plugin_versions({
  fresh = false,
}: { fresh?: boolean } = {}): Promise<PluginVersion[]> {
  return cached(() => PulpStatusAPI.get(), fresh).then(({ data }: { data }) =>
    data.versions.map(({ component, version }) => ({
      name: component,
      version: version,
    })),
  );
}
