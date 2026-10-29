const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { execSync } = require('node:child_process');
const webpack = require('webpack');

// NOTE: This file is not meant to be consumed directly by weback. Instead it
// should be imported, initialized with the following settings and exported like
// a normal webpack config. See config/start.config.js for an example

const isBuild = process.env.NODE_ENV === 'production';

// The build stamps the full commit it was built from. PULP_UI_COMMIT is
// required when there is no git checkout (for example an unpacked source
// archive); otherwise the commit is read from git, which throws when git or the
// repository is missing - the commit is never guessed.
const commit =
  process.env.PULP_UI_COMMIT ||
  execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

// A short hash or a branch name would not pin the build to one source tree.
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error(
    `PULP_UI_COMMIT must be a full 40-character commit hash (lowercase hex), got: ${JSON.stringify(commit)}`,
  );
}

// The stamp comes from the commit, not from the clock, so two builds of one
// commit are byte-identical. Without a date source the date is null.
const commitDate = () => {
  if (process.env.PULP_UI_DATE) {
    return process.env.PULP_UI_DATE;
  }

  try {
    return (
      execSync(`git log -1 --format=%cs ${commit}`, {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null
    );
  } catch {
    return null;
  }
};

// A deployment supplies its own settings at build time by pointing
// PULP_UI_CONFIG at a pulp-ui-config.json; that file is shipped instead of the
// repository's. It is read and checked here so a missing or malformed file
// fails the build instead of surfacing as a broken page in the browser.
const shippedConfigPath = (() => {
  const path = process.env.PULP_UI_CONFIG
    ? resolve(process.env.PULP_UI_CONFIG)
    : resolve(__dirname, '../pulp-ui-config.json');

  if (!process.env.PULP_UI_CONFIG) {
    return path;
  }

  if (!existsSync(path)) {
    throw new Error(`PULP_UI_CONFIG file does not exist: ${path}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(
      `PULP_UI_CONFIG file is not valid JSON: ${path}: ${e.message}`,
      { cause: e },
    );
  }

  if (typeof parsed?.API_BASE_PATH !== 'string') {
    throw new Error(
      `PULP_UI_CONFIG file needs a string API_BASE_PATH: ${path}`,
    );
  }

  const prefixes = parsed.RESERVED_BASE_PATH_PREFIXES;
  if (
    prefixes !== undefined &&
    !(Array.isArray(prefixes) && prefixes.every((p) => typeof p === 'string'))
  ) {
    throw new Error(
      `RESERVED_BASE_PATH_PREFIXES in the PULP_UI_CONFIG file must be an array of strings: ${path}`,
    );
  }

  return path;
})();

const buildInfo = {
  hash: commit,
  date: commitDate(),
  version: require('../package.json').version,
};

// Default user defined settings
const defaultConfigs = [
  // browser: will only be available in the browser, as DefinePlugin constants
  { name: 'UI_BUILD_INFO', default: buildInfo, scope: 'browser' },

  // webpack: will only be available to webpack config, via `customConfigs`
  { name: 'DEV_HOST', default: '0.0.0.0', scope: 'webpack' },
  { name: 'DEV_PORT', scope: 'webpack' },
  { name: 'DEV_HTTPS', scope: 'webpack' },
  { name: 'DEV_PROXY', scope: 'webpack' },
  { name: 'WEBPACK_PUBLIC_PATH', scope: 'webpack' },
];

module.exports = (inputConfigs) => {
  const customConfigs = {};
  const globals = {};

  defaultConfigs
    .filter(({ scope }) => ['webpack'].includes(scope))
    .forEach((item) => {
      customConfigs[item.name] = inputConfigs[item.name] ?? item.default;
    });

  defaultConfigs
    .filter(({ scope }) => ['browser'].includes(scope))
    .forEach((item) => {
      globals[item.name] = JSON.stringify(
        inputConfigs[item.name] ?? item.default,
      );
    });

  return {
    devtool: 'source-map',
    experiments: { typescript: false },
    ...(isBuild
      ? {}
      : {
          devServer: {
            allowedHosts: 'all',
            client: { overlay: false },
            devMiddleware: { writeToDisk: true },
            historyApiFallback: true,
            host: customConfigs.DEV_HOST,
            hot: false,
            liveReload: true,
            onListening: ({ options: { https, port } }) =>
              console.log(
                'App should run on:',
                `${https ? 'https' : 'http'}://localhost:${port}`,
              ),
            port: customConfigs.DEV_PORT,
            // The browser talks to the dev server, which forwards API calls to
            // the target Pulp. The target checks the Host header against its
            // allowed hosts and, for session writes, the Origin (or Referer)
            // header against its trusted origins, so the proxy presents both as
            // the target's own. The proxy adds no credential and leaves TLS
            // verification of the target on; cookies are passed through
            // unchanged (the target sets host-only cookies).
            proxy: Object.entries(customConfigs.DEV_PROXY).map(
              ([path, target]) => {
                const targetOrigin = new URL(target).origin;

                return {
                  context: [path],
                  target,
                  changeOrigin: true,
                  on: {
                    proxyReq: (proxyReq) => {
                      if (proxyReq.getHeader('origin')) {
                        proxyReq.setHeader('origin', targetOrigin);
                      }

                      const referer = proxyReq.getHeader('referer');
                      if (referer) {
                        try {
                          proxyReq.setHeader(
                            'referer',
                            targetOrigin + new URL(String(referer)).pathname,
                          );
                        } catch {
                          // An unparsable referer is dropped rather than
                          // forwarded with the dev server's own origin.
                          proxyReq.removeHeader('referer');
                        }
                      }
                    },
                  },
                };
              },
            ),
            server: { type: customConfigs.DEV_HTTPS ? 'https' : 'http' },
            static: { directory: resolve(__dirname, '../dist') },
          },
        }),

    entry: { App: resolve(__dirname, '../src/entrypoint.tsx') },
    mode: isBuild ? 'production' : 'development',
    module: {
      rules: [
        {
          test: /src\/.*\.(js|jsx|ts|tsx)$/,
          use: [{ loader: 'source-map-loader' }, { loader: 'babel-loader' }],
        },
        {
          test: /\.(css|scss|sass)$/,
          use: [
            isBuild ? MiniCssExtractPlugin.loader : 'style-loader',
            'css-loader',
            'sass-loader',
          ],
        },
        {
          test: /\.(woff(2)?|ttf|jpg|png|eot|gif|svg)(\?v=\d+\.\d+\.\d+)?$/,
          type: 'asset/resource',
          generator: { filename: 'fonts/[name][ext][query]' },
        },
        { test: /\.mjs$/, include: /node_modules/, type: 'javascript/auto' },
      ],
    },
    output: {
      filename: 'js/[name].[fullhash].js',
      path: resolve(__dirname, '../dist'),
      publicPath: customConfigs.WEBPACK_PUBLIC_PATH ?? '/',
      chunkFilename: 'js/[name].[fullhash].js',
    },
    plugins: [
      // sourcemaps
      new webpack.SourceMapDevToolPlugin({
        exclude: /node_modules/,
        filename: 'sourcemaps/[name].[contenthash].js.map',
      }),
      // extract css in prod
      isBuild &&
        new MiniCssExtractPlugin({
          filename: 'css/[name].[contenthash].css',
        }),
      // clean dist/
      new CleanWebpackPlugin({
        cleanOnceBeforeBuildPatterns: ['**/*', '!index.html'],
      }),
      // define global vars
      new webpack.DefinePlugin(globals),
      // typescript check
      new ForkTsCheckerWebpackPlugin(),
      // inject src/index.html
      new HtmlWebpackPlugin({
        favicon: 'static/images/favicon.ico',
        template: resolve(__dirname, '../src/index.html'),
      }),
      // copy pulp-ui-config.json
      new CopyWebpackPlugin({
        patterns: [
          {
            from: shippedConfigPath,
            to: 'pulp-ui-config.json',
          },
        ],
      }),
    ].filter(Boolean),
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      alias: {
        // imports relative to repo root
        src: resolve(__dirname, '../src'),
        static: resolve(__dirname, '../static'),
      },
    },
    watchOptions: {
      // ignore editor files when watching
      ignored: ['**/.*.sw[po]'],
    },
  };
};
