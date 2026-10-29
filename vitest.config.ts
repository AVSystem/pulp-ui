import { defineConfig } from 'vitest/config';

// Runs the application unit tests under src/ and the tests of the repository
// scripts under scripts/. The sdk workspace keeps its own
// configuration and is run through its own test script, so nothing under
// packages/ is collected here. There is deliberately no passWithNoTests: an
// include pattern that matches no file must fail the run, never pass silently.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
    exclude: ['node_modules/**', 'dist/**', 'e2e/**', 'packages/**'],
  },
});
