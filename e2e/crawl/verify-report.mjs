#!/usr/bin/env node
// Checks that a crawl output directory is complete: an index.json and a
// summary.md exist, every route pattern the index lists has a report in each of
// the four theme and width combinations, every report carries all of its fields
// and names a screenshot that exists. It checks completeness only; what the
// reports found (console errors, failed requests, accessibility findings, a
// page that crashed) never makes it fail.
//
// Usage: verify-report.mjs <output directory>
// Prints "ok <what>" or "FAIL <what>: <why>" per check and exits 1 on any FAIL.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const THEMES = ['light', 'dark'];
export const VIEWPORTS = ['desktop', 'phone'];

// The fields every per-screen report has (see e2e/crawl/report.ts).
export const REQUIRED_FIELDS = [
  'route',
  'url',
  'params',
  'theme',
  'viewport',
  'account',
  'title',
  'errorBoundary',
  'loadMs',
  'screenshot',
  'consoleErrors',
  'pageErrors',
  'failedRequests',
  'duplicateRequests',
  'axe',
];

const ARRAY_FIELDS = [
  'consoleErrors',
  'pageErrors',
  'failedRequests',
  'duplicateRequests',
];

function readJson(path) {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const ok = (what) => ({ ok: true, what, why: '' });
const fail = (what, why) => ({ ok: false, what, why });

// Returns one { ok, what, why } per check.
export function verifyReport(dir) {
  const checks = [];

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return [fail('output directory', `${dir} is not a directory`)];
  }

  const summary = join(dir, 'summary.md');
  checks.push(
    existsSync(summary)
      ? ok('summary.md')
      : fail(
          'summary.md',
          'missing: the run did not finish writing its summary',
        ),
  );

  const indexPath = join(dir, 'index.json');
  if (!existsSync(indexPath)) {
    checks.push(
      fail(
        'index.json',
        'missing: it is written only after every screen finished, so the crawl is incomplete or did not run',
      ),
    );
    return checks;
  }
  const index = readJson(indexPath);
  if (index.error) {
    checks.push(fail('index.json', `not valid JSON: ${index.error}`));
    return checks;
  }
  const routes = index.value?.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    checks.push(fail('index.json', 'lists no routes'));
    return checks;
  }
  checks.push(ok(`index.json lists ${routes.length} routes`));
  if (index.value.complete === false) {
    checks.push(fail('index.json', 'says the crawl is not complete'));
  }

  for (const route of routes) {
    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        const what = `${route.pattern} ${theme} ${viewport}`;
        const file = `${route.slug}.${theme}.${viewport}.json`;
        const path = join(dir, file);

        if (!existsSync(path)) {
          checks.push(fail(what, `${file} is missing`));
          continue;
        }
        const read = readJson(path);
        if (read.error) {
          checks.push(fail(what, `${file} is not valid JSON: ${read.error}`));
          continue;
        }

        const report = read.value;
        const problems = [];
        for (const field of REQUIRED_FIELDS) {
          if (!(field in report)) {
            problems.push(`lacks the field ${field}`);
          }
        }
        for (const field of ARRAY_FIELDS) {
          if (field in report && !Array.isArray(report[field])) {
            problems.push(`${field} is not a list`);
          }
        }
        if ('axe' in report && !Array.isArray(report.axe?.violations)) {
          problems.push('axe.violations is not a list');
        }
        // A report left by another run next to this run's index is not part of it.
        if (
          index.value.run !== undefined &&
          report.run !== undefined &&
          report.run !== index.value.run
        ) {
          problems.push('belongs to another crawl run than index.json');
        }
        if (report.route !== undefined && report.route !== route.pattern) {
          problems.push(`route is ${report.route}`);
        }
        if (report.theme !== undefined && report.theme !== theme) {
          problems.push(`theme is ${report.theme}`);
        }
        if (report.viewport !== undefined && report.viewport !== viewport) {
          problems.push(`viewport is ${report.viewport}`);
        }
        if (
          typeof report.screenshot === 'string' &&
          !existsSync(join(dir, report.screenshot))
        ) {
          problems.push(`screenshot ${report.screenshot} is missing`);
        }

        checks.push(
          problems.length
            ? fail(what, `${file} ${problems.join('; ')}`)
            : ok(what),
        );
      }
    }
  }

  return checks;
}

export function main(argv) {
  const dir = argv[0];
  if (!dir) {
    console.error('usage: verify-report.mjs <output directory>');
    return 2;
  }

  const checks = verifyReport(dir);
  for (const check of checks) {
    console.log(
      check.ok ? `ok ${check.what}` : `FAIL ${check.what}: ${check.why}`,
    );
  }
  const failed = checks.filter((check) => !check.ok).length;
  console.log(
    failed
      ? `${failed} of ${checks.length} checks failed`
      : `all ${checks.length} checks passed`,
  );
  return failed ? 1 : 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
