const webpackBase = require('./shared.config');

const proxyTarget = process.env.API_PROXY || 'http://localhost:8080';

module.exports = webpackBase({
  // Address the dev server binds to. The default listens on all interfaces;
  // set DEV_HOST=127.0.0.1 to keep a dev server that proxies to a remote
  // Pulp reachable from this machine only.
  DEV_HOST: process.env.DEV_HOST || undefined,

  // Port that the UI is served over (override with: npm start -- --port N).
  DEV_PORT: 8002,

  // Serve the UI over http or https. Options: true, false
  DEV_HTTPS: false,

  // Value for webpack.devServer.proxy
  // https://webpack.js.org/configuration/dev-server/#devserverproxy
  // used to get around CORS requirements when running in dev mode
  DEV_PROXY: {
    '/api/': proxyTarget,
    '/assets/': proxyTarget,
    '/auth/': proxyTarget,
    '/extensions/': proxyTarget,
    '/pulp/': proxyTarget,
    '/static/rest_framework/': proxyTarget,
    '/v2/': proxyTarget,
  },
});
