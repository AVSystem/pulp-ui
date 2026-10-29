import { lingui } from '@lingui/vite-plugin';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Two projects keep the browser-like setup away from Node tooling tests:
// "app" runs the application tests under src/ in a DOM environment with the
// HTTP mock server and the lingui macro transform, "node" runs the tests of the
// repository scripts under scripts/, of the build configuration under config/
// and of the crawler's report tooling under e2e/crawl/ with no setup at all.
// The sdk workspace keeps its own configuration and is run through its own
// test script, so nothing under packages/ is collected here. There is
// deliberately no passWithNoTests: an include pattern that matches no file must
// fail the run, never pass silently.
const exclude = ['node_modules/**', 'dist/**', 'e2e/**', 'packages/**'];
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
          include: ['src/**/*.test.{ts,tsx}'],
          exclude,
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
