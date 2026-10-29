const { devHost } = require('./dev-host');
const webpackBase = require('./shared.config');

const proxyTarget = process.env.API_PROXY || 'http://localhost:8080';

module.exports = webpackBase({
  // Address the dev server binds to. Loopback only when API_PROXY names a
  // target that is not on this machine, all interfaces otherwise; DEV_HOST
  // overrides either (see config/dev-host.js).
  DEV_HOST: devHost(),

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
