// @vitest-environment node
// Tests of the completeness check of a crawl output directory. The fixtures are
// written to a temporary directory and name only reserved example routes.
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REQUIRED_FIELDS, verifyReport } from './verify-report.mjs';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  'verify-report.mjs',
);
const ROUTES = [
  { pattern: '/status', slug: 'status' },
  {
    pattern: '/deb/repositories/detail/:name',
    slug: 'deb-repositories-detail-by-name',
  },
];
const COMBINATIONS = [
  ['light', 'desktop'],
  ['dark', 'desktop'],
  ['light', 'phone'],
  ['dark', 'phone'],
];

function screen(route, theme, viewport, slug) {
  return {
    route,
    url: 'https://pulp.example.org/ui/x',
    params: 'none',
    theme,
    viewport,
    account: 'admin',
    title: 'Status',
    errorBoundary: false,
    loadMs: 10,
    screenshot: `${slug}.${theme}.${viewport}.png`,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    duplicateRequests: [],
    axe: { violations: [] },
  };
}

// A complete crawl of ROUTES: every combination, a screenshot for each, an
// index and a summary.
function writeFixture(dir) {
  for (const { pattern, slug } of ROUTES) {
    for (const [theme, viewport] of COMBINATIONS) {
      const base = `${slug}.${theme}.${viewport}`;
      writeFileSync(
        join(dir, `${base}.json`),
        JSON.stringify(screen(pattern, theme, viewport, slug)),
      );
      writeFileSync(join(dir, `${base}.png`), 'png');
    }
  }
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ routes: ROUTES }));
  writeFileSync(join(dir, 'summary.md'), '# Crawl\n');
}

const failures = (dir) =>
  verifyReport(dir)
    .filter((check) => !check.ok)
    .map((check) => `${check.what}: ${check.why}`);

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'verify-report-'));
  writeFixture(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('verifyReport', () => {
  it('passes a directory with every route in all four combinations', () => {
    expect(failures(dir)).toEqual([]);
  });

  it('fails when one combination of one route is missing', () => {
    rmSync(join(dir, 'status.dark.phone.json'));
    const found = failures(dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('/status dark phone');
  });

  it('fails when a screenshot file is missing', () => {
    rmSync(join(dir, 'deb-repositories-detail-by-name.light.desktop.png'));
    const found = failures(dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('screenshot');
  });

  it.each(REQUIRED_FIELDS)(
    'fails when a report lacks the field %s',
    (field) => {
      const file = join(dir, 'status.light.phone.json');
      const report = JSON.parse(readFileSync(file, 'utf8'));
      delete report[field];
      writeFileSync(file, JSON.stringify(report));
      expect(failures(dir).join('\n')).toContain(field);
    },
  );

  it('fails when index.json is absent, as an unfinished crawl leaves it', () => {
    rmSync(join(dir, 'index.json'));
    expect(failures(dir).join('\n')).toContain('index.json');
  });

  it('fails when summary.md is absent', () => {
    rmSync(join(dir, 'summary.md'));
    expect(failures(dir).join('\n')).toContain('summary.md');
  });

  it('fails on an empty directory and on one that does not exist', () => {
    const empty = mkdtempSync(join(tmpdir(), 'verify-report-empty-'));
    try {
      expect(failures(empty).length).toBeGreaterThan(0);
      expect(failures(join(empty, 'missing')).length).toBeGreaterThan(0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('does not fail on findings in the reports', () => {
    const file = join(dir, 'status.dark.desktop.json');
    const report = JSON.parse(readFileSync(file, 'utf8'));
    report.errorBoundary = true;
    report.consoleErrors = [{ text: 'boom', location: '', expected: false }];
    report.pageErrors = ['boom'];
    report.failedRequests = [
      { method: 'GET', url: 'x', status: 500, expected: false },
    ];
    report.axe = {
      violations: [
        {
          id: 'color-contrast',
          impact: 'serious',
          help: 'h',
          nodes: 3,
          targets: [],
        },
      ],
    };
    writeFileSync(file, JSON.stringify(report));
    expect(failures(dir)).toEqual([]);
  });

  it('fails on a report whose route or theme disagrees with its file name', () => {
    const file = join(dir, 'status.dark.phone.json');
    const report = JSON.parse(readFileSync(file, 'utf8'));
    report.theme = 'light';
    writeFileSync(file, JSON.stringify(report));
    expect(failures(dir).join('\n')).toContain('theme');
  });

  it('fails on a report left by another crawl run', () => {
    writeFileSync(
      join(dir, 'index.json'),
      JSON.stringify({ routes: ROUTES, run: 'new' }),
    );
    const file = join(dir, 'status.dark.phone.json');
    const report = JSON.parse(readFileSync(file, 'utf8'));
    report.run = 'old';
    writeFileSync(file, JSON.stringify(report));
    const found = failures(dir);
    expect(found.length).toBeGreaterThan(0);
    expect(found.join('\n')).toContain('another crawl run');
  });

  it('fails on a report that is not valid JSON', () => {
    writeFileSync(join(dir, 'status.dark.phone.json'), '{ not json');
    expect(failures(dir).join('\n')).toContain('status.dark.phone.json');
  });
});

describe('command line', () => {
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('prints ok lines and exits 0 on a complete directory', () => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^ok /m);
    expect(result.stdout).not.toMatch(/^FAIL /m);
  });

  it('prints FAIL lines and exits 1 on an incomplete directory', () => {
    mkdirSync(join(dir, 'sub'));
    rmSync(join(dir, 'index.json'));
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^FAIL index\.json/m);
  });

  it('exits non-zero without a directory argument', () => {
    expect(run().status).not.toBe(0);
  });
});
