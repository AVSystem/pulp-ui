import defaults from '../pulp-ui-config.json';

export const configPromise = fetch('/pulp-ui-config.json')
  .then((data) =>
    data.status > 0 && data.status < 300
      ? data.json()
      : Promise.reject(`${data.status}: ${data.statusText}`),
  )
  .then((data) => (config = data));

export let config = null;

// The bundled defaults stand in for a configuration that could not be loaded,
// except for the reserved base path prefixes: a deployment's list cannot be
// guessed, so it is marked unknown (null) rather than taken as an empty list.
export const configFallback = () =>
  (config = { ...defaults, RESERVED_BASE_PATH_PREFIXES: null });
