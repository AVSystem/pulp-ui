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
import { orderScreens, scoreOf, summarizeRun } from './summarize.ts';
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
