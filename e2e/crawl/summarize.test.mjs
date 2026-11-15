// @vitest-environment node
// Tests of the run summary: the order of the screens and when index.json is
// written. Fixtures use only reserved example names.
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  orderScreens,
  renderSummary,
  scoreOf,
  summarizeRun,
  totalsOf,
} from './summarize.ts';
import { verifyReport } from './verify-report.mjs';

const ROUTES = [
  { pattern: '/a', slug: 'a', params: [] },
  { pattern: '/b', slug: 'b', params: [] },
];
const COMBINATIONS = [
  ['light', 'desktop'],
  ['dark', 'desktop'],
  ['light', 'phone'],
  ['dark', 'phone'],
];

function report(route, slug, theme, viewport, run, extra = {}) {
  return {
    route,
    url: 'https://pulp.example.org/ui/x',
    params: 'none',
    theme,
    viewport,
    account: 'admin',
    title: 'T',
    errorBoundary: false,
    signedIn: true,
    loadMs: 5,
    settled: true,
    screenshot: `${slug}.${theme}.${viewport}.png`,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    duplicateRequests: [],
    axe: { violations: [] },
    uiBuild: { hash: 'abc', version: '1' },
    run,
    capturedAt: '2000-01-01T00:00:00.000Z',
    ...extra,
  };
}

function write(dir, item) {
  const base = `${item.screenshot.replace(/\.png$/, '')}`;
  writeFileSync(join(dir, `${base}.json`), JSON.stringify(item));
  writeFileSync(join(dir, item.screenshot), 'png');
}

function writeRun(dir, run, skip = () => false) {
  for (const { pattern, slug } of ROUTES) {
    for (const [theme, viewport] of COMBINATIONS) {
      if (!skip(slug, theme, viewport)) {
        write(dir, report(pattern, slug, theme, viewport, run));
      }
    }
  }
}

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'summarize-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('order', () => {
  it('puts the worst screen first and breaks ties by route, theme, width', () => {
    const crashed = report('/z', 'z', 'light', 'desktop', 'r', {
      errorBoundary: true,
    });
    const quiet = [
      report('/b', 'b', 'dark', 'phone', 'r'),
      report('/b', 'b', 'light', 'phone', 'r'),
      report('/b', 'b', 'light', 'desktop', 'r'),
      report('/a', 'a', 'dark', 'desktop', 'r'),
    ];
    const ordered = orderScreens([...quiet, crashed]).map(
      (r) => `${r.route} ${r.theme} ${r.viewport}`,
    );
    expect(ordered).toEqual([
      '/z light desktop',
      '/a dark desktop',
      '/b dark phone',
      '/b light desktop',
      '/b light phone',
    ]);
  });

  it('gives the same order for the same data in any input order', () => {
    const items = COMBINATIONS.map(([t, v]) => report('/a', 'a', t, v, 'r'));
    const forward = orderScreens(items).map((r) => `${r.theme}${r.viewport}`);
    const backward = orderScreens([...items].reverse()).map(
      (r) => `${r.theme}${r.viewport}`,
    );
    expect(forward).toEqual(backward);
  });

  it('does not count expected answers as findings', () => {
    const expected = report('/a', 'a', 'light', 'desktop', 'r', {
      failedRequests: [
        { method: 'GET', url: 'x', status: 401, expected: true },
      ],
      consoleErrors: [{ text: 't', location: '', expected: true }],
    });
    expect(scoreOf(expected)).toBe(0);
  });
});

describe('summarizeRun', () => {
  it('writes the summary and the index of a complete run', () => {
    writeRun(dir, 'one');
    expect(summarizeRun(dir, ROUTES, 'one')).toBe(true);
    expect(existsSync(join(dir, 'index.json'))).toBe(true);
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toContain(
      'Complete: yes',
    );
    expect(verifyReport(dir).filter((c) => !c.ok)).toEqual([]);
  });

  it('writes no index for a run that lacks a screen', () => {
    writeRun(
      dir,
      'one',
      (slug, theme, viewport) =>
        slug === 'b' && theme === 'dark' && viewport === 'phone',
    );
    expect(summarizeRun(dir, ROUTES, 'one')).toBe(true);
    expect(existsSync(join(dir, 'index.json'))).toBe(false);
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toContain(
      'Complete: no',
    );
    expect(verifyReport(dir).filter((c) => !c.ok).length).toBeGreaterThan(0);
  });

  it('removes the index and the files of an earlier run when a new run is incomplete', () => {
    writeRun(dir, 'old');
    summarizeRun(dir, ROUTES, 'old');
    writeRun(dir, 'new', (slug) => slug === 'b');
    summarizeRun(dir, ROUTES, 'new');
    expect(existsSync(join(dir, 'index.json'))).toBe(false);
    expect(existsSync(join(dir, 'b.light.desktop.json'))).toBe(false);
    expect(existsSync(join(dir, 'a.light.desktop.json'))).toBe(true);
  });

  it('touches nothing when no report belongs to the run', () => {
    writeRun(dir, 'old');
    summarizeRun(dir, ROUTES, 'old');
    const before = readFileSync(join(dir, 'summary.md'), 'utf8');
    expect(summarizeRun(dir, ROUTES, 'other')).toBe(false);
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toBe(before);
    expect(existsSync(join(dir, 'index.json'))).toBe(true);
  });

  it('leaves files that are not crawl output alone', () => {
    writeRun(dir, 'one');
    writeFileSync(join(dir, 'notes.txt'), 'keep');
    summarizeRun(dir, ROUTES, 'one');
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('keep');
  });

  it('writes no host into the summary', () => {
    writeRun(dir, 'one');
    summarizeRun(dir, ROUTES, 'one');
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).not.toContain(
      'pulp.example.org',
    );
  });
});

describe('design findings', () => {
  const contrast = {
    id: 'color-contrast',
    impact: 'serious',
    help: 'Elements must meet minimum color contrast ratio thresholds',
    nodes: 3,
    targets: ['.a'],
  };
  const design = {
    fontSizes: ['13px', '14px'],
    fontFamilies: ['Red Hat Text', 'Georgia'],
    foreignRequests: ['https://fonts.example'],
    axe: { violations: [contrast], incompleteContrast: 4 },
  };
  const dirty = report('/a', 'a', 'dark', 'phone', 'r', design);
  const clean = report('/b', 'b', 'light', 'desktop', 'r', {
    fontSizes: ['12px', '14px', '18px', '28px'],
    fontFamilies: ['Red Hat Display', 'Red Hat Mono', 'Red Hat Text'],
    foreignRequests: [],
    axe: { violations: [], incompleteContrast: 0 },
  });

  it('counts the findings of the design fields in the totals', () => {
    expect(totalsOf([dirty, clean])).toMatchObject({
      contrastViolations: 1,
      undecidedContrast: 4,
      seriousAccessibility: 1,
      offScaleFontScreens: 1,
      foreignRequests: 1,
      foreignFontScreens: 1,
    });
  });

  it('counts nothing for reports of an older crawl without the fields', () => {
    expect(
      totalsOf([report('/a', 'a', 'light', 'desktop', 'r')]),
    ).toMatchObject({
      contrastViolations: 0,
      undecidedContrast: 0,
      seriousAccessibility: 0,
      offScaleFontScreens: 0,
      foreignRequests: 0,
      foreignFontScreens: 0,
    });
  });

  it('adds the totals rows after the existing ones and names the findings', () => {
    const text = renderSummary([dirty, clean], ROUTES, true);
    for (const row of [
      '| Color contrast violations | 1 |',
      '| Color contrast checks axe could not complete | 4 |',
      '| Serious or critical accessibility violations | 1 |',
      '| Screens with an off-scale font size | 1 |',
      '| Requests to another host | 1 |',
      '| Screens with a font outside the Red Hat families | 1 |',
    ]) {
      expect(text).toContain(row);
    }
    const last = text.indexOf(
      '| Console lines of expected failed requests (not counted above) |',
    );
    expect(text.indexOf('| Color contrast violations |')).toBeGreaterThan(last);
    const section = (title) =>
      text.slice(text.indexOf(`## ${title}`)).split('\n## ')[0];
    expect(section('Font sizes outside the scale')).toMatch(
      /\/a \| dark \| phone \| 13px/,
    );
    expect(section('Requests to another host')).toContain(
      'https://fonts.example',
    );
    expect(section('Fonts outside the Red Hat families')).toContain('Georgia');
    expect(section('Color contrast violations')).toMatch(
      /\/a \| dark \| phone/,
    );
    expect(section('Color contrast checks axe could not complete')).toMatch(
      /\/a \| dark \| phone \| 4/,
    );
    expect(section('Serious or critical accessibility violations')).toContain(
      'color-contrast',
    );
    expect(section('Font sizes outside the scale')).not.toContain('/b');
  });

  it('keeps the existing totals rows and the Screens table header', () => {
    const text = renderSummary([clean], ROUTES, true);
    for (const row of [
      '| Screens that crashed into the error page | 0 |',
      '| Uncaught errors | 0 |',
      '| Failed requests | 0 |',
      '| Console errors | 0 |',
      '| Accessibility rule violations | 0 |',
      '| Repeated requests | 0 |',
      '| Screens that did not settle | 0 |',
    ]) {
      expect(text).toContain(row);
    }
    expect(text).toContain(
      '| # | Route | Theme | Width | Params | Score | Error page | Uncaught | Failed | Console | Axe | Repeated | Settled | Load ms | Report |',
    );
  });

  it('writes a complete run with design fields that still verifies', () => {
    for (const { pattern, slug } of ROUTES) {
      for (const [theme, viewport] of COMBINATIONS) {
        write(dir, report(pattern, slug, theme, viewport, 'one', design));
      }
    }
    expect(summarizeRun(dir, ROUTES, 'one')).toBe(true);
    expect(verifyReport(dir).filter((c) => !c.ok)).toEqual([]);
  });
});
