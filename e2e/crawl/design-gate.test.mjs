// @vitest-environment node
// Tests of the design gate over a crawl output directory. The fixtures are
// written to a temporary directory and name only reserved example routes.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALLOWED_FONT_SIZES,
  designGate,
  isRedHatFamily,
} from './design-gate.mjs';
import {
  ALLOWED_FONT_SIZES as SUMMARY_SIZES,
  isRedHatFamily as summaryFamily,
} from './summarize.ts';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'design-gate.mjs');
const ROUTES = [
  { pattern: '/status', slug: 'status' },
  { pattern: '/tasks', slug: 'tasks' },
];
const COMBINATIONS = [
  ['light', 'desktop'],
  ['dark', 'desktop'],
  ['light', 'phone'],
  ['dark', 'phone'],
];

const clean = () => ({
  fontSizes: ['12px', '14px', '18px', '28px'],
  fontFamilies: ['Red Hat Display', 'Red Hat Mono', 'Red Hat Text'],
  foreignRequests: [],
  axe: { violations: [], incompleteContrast: 0 },
});

const violation = (id, impact, nodes = 1) => ({
  id,
  impact,
  help: 'h',
  nodes,
  targets: [],
});

// A crawl of ROUTES in every combination; `change` may edit one report.
function writeCrawl(dir, change) {
  const screens = [];
  for (const { pattern, slug } of ROUTES) {
    for (const [theme, viewport] of COMBINATIONS) {
      const file = `${slug}.${theme}.${viewport}.json`;
      const report = { route: pattern, theme, viewport, ...clean() };
      change?.(report);
      writeFileSync(join(dir, file), JSON.stringify(report));
      screens.push({ route: pattern, theme, viewport, file });
    }
  }
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify({ routes: ROUTES, screens }),
  );
}

const edit = (route, theme, viewport, change) => (report) => {
  if (
    report.route === route &&
    report.theme === theme &&
    report.viewport === viewport
  ) {
    change(report);
  }
};

const fails = (dir) => designGate(dir).checks.filter((check) => !check.ok);

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'design-gate-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('designGate', () => {
  it('passes a crawl that keeps every promise', () => {
    writeCrawl(dir);
    const result = designGate(dir);
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it('fails a font size outside the scale and names the screen and the size', () => {
    writeCrawl(
      dir,
      edit('/tasks', 'dark', 'phone', (r) => r.fontSizes.push('16px')),
    );
    const found = fails(dir);
    expect(found).toHaveLength(1);
    expect(found[0].what).toContain('/tasks dark phone');
    expect(found[0].why).toContain('16px');
  });

  it('fails a request to another origin', () => {
    writeCrawl(
      dir,
      edit('/status', 'light', 'desktop', (r) => {
        r.foreignRequests = ['https://fonts.example'];
      }),
    );
    const found = fails(dir);
    expect(found).toHaveLength(1);
    expect(found[0].what).toContain('/status light desktop');
    expect(found[0].why).toContain('https://fonts.example');
  });

  it('fails a color-contrast violation', () => {
    writeCrawl(
      dir,
      edit('/status', 'dark', 'desktop', (r) =>
        r.axe.violations.push(violation('color-contrast', 'serious', 4)),
      ),
    );
    const found = fails(dir);
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((c) => c.what).join('\n')).toContain(
      '/status dark desktop',
    );
    expect(found.map((c) => c.why).join('\n')).toContain('color-contrast');
  });

  it('fails a color-contrast violation whatever its impact', () => {
    writeCrawl(
      dir,
      edit('/status', 'dark', 'desktop', (r) =>
        r.axe.violations.push(violation('color-contrast', 'moderate')),
      ),
    );
    expect(fails(dir).length).toBeGreaterThan(0);
  });

  it.each(['serious', 'critical'])(
    'fails a %s violation of another rule',
    (impact) => {
      writeCrawl(
        dir,
        edit('/tasks', 'light', 'phone', (r) =>
          r.axe.violations.push(violation('button-name', impact)),
        ),
      );
      const found = fails(dir);
      expect(found).toHaveLength(1);
      expect(found[0].what).toContain('/tasks light phone');
      expect(found[0].why).toContain('button-name');
    },
  );

  it('does not fail a moderate or minor violation of another rule', () => {
    writeCrawl(dir, (r) => {
      r.axe.violations.push(violation('region', 'moderate'));
      r.axe.violations.push(violation('landmark-unique', 'minor'));
    });
    expect(fails(dir)).toEqual([]);
  });

  it('fails a font family outside the Red Hat families', () => {
    writeCrawl(
      dir,
      edit('/status', 'light', 'phone', (r) => r.fontFamilies.push('Georgia')),
    );
    const found = fails(dir);
    expect(found).toHaveLength(1);
    expect(found[0].why).toContain('Georgia');
  });

  it('accepts the variable-font and legacy names of the Red Hat families', () => {
    writeCrawl(dir, (r) => {
      r.fontFamilies = ['Red Hat Text VF', 'RedHatDisplay', 'Red Hat Mono'];
    });
    expect(fails(dir)).toEqual([]);
  });

  it('fails a report without the design fields, as an older crawl has it', () => {
    writeCrawl(
      dir,
      edit('/status', 'light', 'desktop', (r) => {
        delete r.fontSizes;
        delete r.fontFamilies;
        delete r.foreignRequests;
        delete r.axe.incompleteContrast;
      }),
    );
    const found = fails(dir);
    expect(found).toHaveLength(1);
    expect(found[0].what).toContain('/status light desktop');
    expect(found[0].why).toContain('report lacks design fields');
  });

  it('reports the undecided contrast total without failing on it', () => {
    writeCrawl(
      dir,
      edit('/status', 'light', 'desktop', (r) => {
        r.axe.incompleteContrast = 7;
      }),
    );
    const result = designGate(dir);
    expect(result.checks.filter((c) => !c.ok)).toEqual([]);
    expect(result.info.join('\n')).toMatch(/7/);
  });

  it('keeps its allowed lists in step with the summary', () => {
    expect(ALLOWED_FONT_SIZES).toEqual(['12px', '14px', '18px', '28px']);
    expect(SUMMARY_SIZES).toEqual(ALLOWED_FONT_SIZES);
    for (const name of [
      'Red Hat Text',
      'Red Hat Display VF',
      'RedHatMono',
      'Georgia',
      'Red Hat',
      '',
    ]) {
      expect(summaryFamily(name)).toBe(isRedHatFamily(name));
    }
    expect(isRedHatFamily('Red Hat Text')).toBe(true);
    expect(isRedHatFamily('Red Hat')).toBe(false);
  });
});

describe('command line', () => {
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  it('prints ok lines, the info line and exits 0 on a passing crawl', () => {
    writeCrawl(dir);
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^ok /m);
    expect(result.stdout).toMatch(/^info .*could not complete/m);
    expect(result.stdout).not.toMatch(/^FAIL /m);
  });

  it('prints a FAIL line naming route, theme and width and exits 1', () => {
    writeCrawl(
      dir,
      edit('/tasks', 'dark', 'phone', (r) => r.fontSizes.push('16px')),
    );
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^FAIL .*\/tasks dark phone/m);
  });

  it('prints FAIL "report lacks design fields" for an older crawl and exits 1', () => {
    writeCrawl(dir, (r) => {
      delete r.fontSizes;
      delete r.fontFamilies;
      delete r.foreignRequests;
    });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('report lacks design fields');
  });

  it('exits 2 without a directory argument', () => {
    expect(run().status).toBe(2);
  });

  it('exits 2 for a directory that does not exist', () => {
    expect(run(join(dir, 'missing')).status).toBe(2);
  });

  it('exits 2 for a directory without an index', () => {
    expect(run(dir).status).toBe(2);
  });

  it('exits 2 for an index that is not valid JSON', () => {
    writeFileSync(join(dir, 'index.json'), '{ nope');
    expect(run(dir).status).toBe(2);
  });

  it('exits 2 when a report the index names cannot be read', () => {
    writeCrawl(dir);
    rmSync(join(dir, 'status.light.phone.json'));
    expect(run(dir).status).toBe(2);
  });

  it.each([
    ['null', 'null'],
    ['a number', '7'],
    ['an array', '[]'],
  ])('exits 2 when a report is %s', (_what, content) => {
    writeCrawl(dir);
    writeFileSync(join(dir, 'status.light.phone.json'), content);
    const result = run(dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('not a screen report');
    expect(result.stderr).not.toContain('TypeError');
  });

  it.each([
    ['has no file', { route: '/status', theme: 'light', viewport: 'phone' }],
    ['is null', null],
    ['has a file that is not text', { file: 3 }],
  ])('exits 2 when an index entry %s', (_what, entry) => {
    writeCrawl(dir);
    writeFileSync(
      join(dir, 'index.json'),
      JSON.stringify({ routes: ROUTES, screens: [entry] }),
    );
    const result = run(dir);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('without a report file');
    expect(result.stderr).not.toContain('TypeError');
  });
});
