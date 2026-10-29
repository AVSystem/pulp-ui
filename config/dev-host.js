// Address the dev server binds to.
//
// The dev proxy presents the target's own Host, Origin and Referer, which
// defeats the target's origin checks for any client that reaches the dev
// server. With a remote target, a dev server listening on every interface
// would let anyone on the same network use this machine as a relay to a
// server that may be reachable only from here. So when API_PROXY names a
// target that is not on this machine the default is loopback only. DEV_HOST is
// the explicit override in both directions.

const LOOPBACK = '127.0.0.1';

function isLocalTarget(target) {
  let hostname;
  try {
    hostname = new URL(target).hostname.toLowerCase();
  } catch {
    // An unparsable target is treated as remote: the safe default.
    return false;
  }
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127(\.\d{1,3}){3}$/.test(hostname)
  );
}

/** The bind address for the dev server, or undefined to keep the default. */
function devHost(env = process.env) {
  if (env.DEV_HOST) {
    return env.DEV_HOST;
  }
  if (env.API_PROXY && !isLocalTarget(env.API_PROXY)) {
    return LOOPBACK;
  }
  return undefined;
}

module.exports = { devHost, isLocalTarget };
