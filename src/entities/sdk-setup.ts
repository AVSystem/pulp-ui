import { configurePulpFetch } from '@pulp-ui/sdk/mutator/pulp-fetch';
import { resolveApiUrl } from 'src/session/request-policy';

// Binds the application's request rules to the generated client. Called once
// before anything is rendered: until then a generated call would go out
// without the configured API base.
export function installSdkRequestPolicy() {
  configurePulpFetch({
    resolveUrl: resolveApiUrl,
    beforeRequest: () => undefined,
  });
}
