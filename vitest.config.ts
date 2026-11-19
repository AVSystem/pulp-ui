import { lingui } from '@lingui/vite-plugin';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Two projects keep the browser-like setup away from Node tooling tests:
// "app" runs the application tests under src/ in a DOM environment with the
// HTTP mock server and the lingui macro transform, "node" runs the tests of the
// repository scripts under scripts/, of the build configuration under config/
// and of the crawler's report tooling under e2e/crawl/ with no setup at all.
// The sdk workspace has no configuration of its own: its tests under
// packages/sdk/src run in the app project, and only its build output and
// installed packages are left out. There is deliberately no passWithNoTests: an
// include pattern that matches no file must fail the run, never pass silently.
const exclude = [
  'node_modules/**',
  'dist/**',
  'e2e/**',
  'packages/*/dist/**',
  'packages/*/node_modules/**',
];
// The end-to-end directory belongs to Playwright except for the report tooling
// tests, which are plain Node tests.
const nodeExclude = exclude.filter((pattern) => pattern !== 'e2e/**');

const root = import.meta.dirname;

export default defineConfig({
  plugins: [lingui({ macroTransform: true })],
  resolve: {
    // mirrors the paths of tsconfig.json
    alias: {
      src: resolve(root, 'src'),
      static: resolve(root, 'static'),
    },
  },
  // The bundler injects the build stamp as a constant; components that show it
  // need a value under test as well.
  define: {
    UI_BUILD_INFO: JSON.stringify({
      hash: '0'.repeat(40),
      date: null,
      version: 'test',
    }),
  },
  test: {
    // Every test file declares one of these tags; an undeclared tag fails the run.
    tags: [
      {
        name: 'integration',
        description:
          'ACL client functions tested against MSW-mocked Pulp responses - not a real backend',
      },
      {
        name: 'unit',
        description:
          'Pure functions, Zod schemas, and ACL codecs - no network or DOM',
      },
    ],
    // In CI the verbose reporter names every test file in the job log, so a
    // test file that stops being collected is visible there.
    reporters: process.env['CI'] ? ['verbose'] : ['default'],
    projects: [
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'happy-dom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'packages/sdk/src/**/*.test.ts'],
          exclude,
          // The class maps of PatternFly components import their stylesheet;
          // Node cannot load it, the test transform turns it into an empty module.
          server: { deps: { inline: [/@patternfly\/react-styles/] } },
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'scripts/**/*.test.{ts,mjs}',
            'config/**/*.test.ts',
            'e2e/**/*.test.mjs',
          ],
          exclude: nodeExclude,
        },
      },
    ],
  },
});
