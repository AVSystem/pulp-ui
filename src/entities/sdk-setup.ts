import { loginRead } from '@pulp-ui/sdk/core/login';
import { configurePulpFetch } from '@pulp-ui/sdk/mutator/pulp-fetch';
import {
  type IRequestContext,
  handleFailure,
  prepareRequest,
  resolveApiUrl,
} from 'src/session/request-policy';

// Binds the application's request rules to the generated client: the same
// session policy the legacy client follows. Called once before anything is
// rendered: until then a generated call would go out without the configured
// API base.
export function installSdkRequestPolicy() {
  configurePulpFetch<IRequestContext>({
    resolveUrl: resolveApiUrl,
    beforeRequest: prepareRequest,
    onFailure: (error, context) =>
      handleFailure(
        error.status,
        context.url,
        error,
        () => loginRead(),
        context,
      ),
  });
}
