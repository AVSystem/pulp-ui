// @vitest-environment node
// Plain Pulp does not serve the endpoints that only galaxy_ng adds: the
// internal UI API, the execution environment plugin API and the collection
// API that lives under a v3/ prefix. A request to one of them answers 404.
// The same goes for the feature flags and signing-service settings that
// galaxy_ng publishes: plain Pulp has neither, so no source file may read them.
// A path that starts with v3/ is also wrong in its own right: it resolves
// under the API base, which already ends in v3/, to a doubled v3 that plain
// Pulp does not serve. No source file may build such a request.
//
// The patterns are assembled from parts at run time so that this file holds
// none of the strings it looks for.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

const quote = '[\'"`]';
const forbidden: { what: string; pattern: RegExp }[] = [
  {
    what: 'a call to the internal UI API of galaxy_ng',
    pattern: new RegExp(['_ui', 'v1'].join('/')),
  },
  {
    what: 'a call to the execution environment plugin API of galaxy_ng',
    pattern: new RegExp(['v3', 'plugin', 'execution-environments'].join('/')),
  },
  {
    what: 'a request path that starts with v3/ (doubled under the API base)',
    pattern: new RegExp(quote + ['v3', ''].join('/')),
  },
  {
    what: 'a read of the Hub feature flags',
    pattern: new RegExp(['feature', 'Flags'].join('')),
  },
  {
    what: 'the Hub collection signing service setting',
    pattern: new RegExp(
      ['GALAXY', 'COLLECTION', 'SIGNING', 'SERVICE'].join('_'),
    ),
  },
  {
    what: 'the Hub container signing service setting',
    pattern: new RegExp(
      ['GALAXY', 'CONTAINER', 'SIGNING', 'SERVICE'].join('_'),
    ),
  },
];

const HOW_TO_FIX =
  'Use the plain plugin API of Pulp (for example content/ansible/..., repositories/ansible/..., distributions/container/...) through the API modules under src/api, or show a placeholder for a screen that has no plain API yet. The behaviour of plain Pulp is the default: no flag or setting switches a Hub behaviour on, and detecting what the server offers belongs to the plugin screens that need it.';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    const isSource = /\.tsx?$/.test(entry.name);
    return isSource && !entry.name.includes('.test.') ? [path] : [];
  });
}

describe('galaxy_ng endpoints', () => {
  it('are not called from any source file', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          forbidden
            .filter(({ pattern }) => pattern.test(line))
            .map(({ what }) => `${relative(SRC, file)}:${index + 1}: ${what}`),
        ),
    );

    expect(offenders, HOW_TO_FIX).toEqual([]);
  });
});
