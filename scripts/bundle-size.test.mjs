// @vitest-environment node
// Tests of the initial-load size check. Fixtures are temporary dist folders
// with incompressible assets of known size, so the measured sizes are stable.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compare,
  formatReport,
  gzipSize,
  measure,
  parseAssets,
} from './bundle-size.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'bundle-size.mjs');

const INDEX_UNQUOTED =
  '<!doctype html><html lang=en-US><head><meta charset=UTF-8><title>Pulp UI</title>' +
  '<link rel=icon href=/static/pulp_ui/favicon.ico>' +
  '<script defer src=/static/pulp_ui/js/App.abc.js></script>' +
  '<link href=/static/pulp_ui/css/App.def.css rel=stylesheet>' +
  '</head><body><div id=root></div></body></html>';

const INDEX_QUOTED =
  '<html><head><link rel="icon" href="/static/pulp_ui/favicon.ico">' +
  '<script defer src="/static/pulp_ui/js/App.abc.js"></script>' +
  "<link href='/static/pulp_ui/css/App.def.css' rel='stylesheet'>" +
  '<link rel="apple-touch-icon" href="/static/pulp_ui/img/logo.png">' +
  '</head><body></body></html>';

describe('parseAssets', () => {
  it('finds the script and the stylesheet of a minified page with unquoted attributes', () => {
    expect(parseAssets(INDEX_UNQUOTED)).toEqual([
      'js/App.abc.js',
      'css/App.def.css',
    ]);
  });

  it('gives the same result for quoted attributes and ignores images and icons', () => {
    expect(parseAssets(INDEX_QUOTED)).toEqual([
      'js/App.abc.js',
      'css/App.def.css',
    ]);
  });

  it('lists an asset named twice once', () => {
    const html = INDEX_UNQUOTED.replace(
      '</head>',
      '<script src=/static/pulp_ui/js/App.abc.js></script></head>',
    );
    expect(parseAssets(html)).toEqual(['js/App.abc.js', 'css/App.def.css']);
  });

  it('rejects a script that is not under a js or css folder', () => {
    const html = '<script src=/static/pulp_ui/other/x.js></script>';
    expect(() => parseAssets(html)).toThrow(/other\/x\.js.*not under/);
  });

  it('rejects a stylesheet that is not under a js or css folder', () => {
    const html = '<link href=/static/pulp_ui/x.css rel=stylesheet>';
    expect(() => parseAssets(html)).toThrow(/x\.css.*not under/);
  });
});

describe('gzipSize', () => {
  it('is the size of the buffer compressed at the highest level', () => {
    const buf = Buffer.from('abc'.repeat(1000));
    expect(gzipSize(buf)).toBe(gzipSync(buf, { level: 9 }).length);
    expect(gzipSize(buf)).toBeLessThan(buf.length);
  });
});

describe('compare', () => {
  it('accepts a total within or equal to the budget', () => {
    expect(compare(100, 200)).toEqual({ ok: true, over: 0 });
    expect(compare(200, 200)).toEqual({ ok: true, over: 0 });
  });

  it('reports by how much the total is over the budget', () => {
    expect(compare(250, 200)).toEqual({ ok: false, over: 50 });
  });
});

let dist;
const write = (rel, data) => {
  mkdirSync(dirname(join(dist, rel)), { recursive: true });
  writeFileSync(join(dist, rel), data);
};
const incompressible = (n) => randomBytes(n);

const run = (args, env = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...env },
  });

const writeBudget = (value) => {
  const file = join(dist, '..', `budget-${process.pid}.json`);
  writeFileSync(file, JSON.stringify({ initialGzipBytes: value }));
  return file;
};

beforeEach(() => {
  dist = join(mkdtempSync(join(tmpdir(), 'bundle-size-')), 'dist');
  mkdirSync(dist);
  write('index.html', INDEX_UNQUOTED);
  write('js/App.abc.js', incompressible(3000));
  write('css/App.def.css', incompressible(2000));
  write('js/section.111.js', incompressible(500));
  write('css/section.222.css', incompressible(400));
  write('js/App.abc.js.map', incompressible(9000));
  write('js/App.abc.js.LICENSE.txt', 'licenses');
});

afterEach(() => {
  rmSync(dirname(dist), { recursive: true, force: true });
});

describe('measure', () => {
  it('sums the gzip size of the assets the page names and lists the rest apart', () => {
    const result = measure(dist);
    const expected =
      gzipSize(readFileSync(join(dist, 'js/App.abc.js'))) +
      gzipSize(readFileSync(join(dist, 'css/App.def.css')));
    expect(result.total).toBe(expected);
    expect(result.initial.map((a) => a.path)).toEqual([
      'js/App.abc.js',
      'css/App.def.css',
    ]);
    expect(result.others.map((a) => a.path).sort()).toEqual([
      'css/section.222.css',
      'js/section.111.js',
    ]);
  });

  it('refuses an asset path that leaves the dist folder', () => {
    write(
      'index.html',
      '<script src=/static/pulp_ui/js/../../outside.js></script>',
    );
    writeFileSync(join(dist, '..', 'outside.js'), 'x');
    expect(() => measure(dist)).toThrow(/outside/);
  });
});

describe('formatReport', () => {
  it('prints the headline first and names every other chunk in both outputs', () => {
    const report = formatReport({ ...measure(dist), budget: 100000 });
    expect(report.text.split('\n')[0]).toMatch(
      /^Initial load: \d+ bytes gzip \(budget 100000\)$/,
    );
    for (const out of [report.text, report.markdown]) {
      expect(out).toContain('js/section.111.js');
      expect(out).toContain('css/section.222.css');
      expect(out).not.toContain('.map');
      expect(out).not.toContain('LICENSE');
    }
    expect(report.markdown).toContain('| --- |');
  });
});

describe('command line', () => {
  it('exits 0 within the budget and prints the headline and the chunk table', () => {
    const budget = writeBudget(100000);
    const res = run(['--budget', budget, '--dist', dist]);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(
      /^Initial load: \d+ bytes gzip \(budget 100000\)/,
    );
    expect(res.stdout).toContain('js/section.111.js');
    expect(res.stdout).toContain('css/section.222.css');
    expect(res.stdout).not.toContain('.map');
    expect(res.stdout).not.toContain('LICENSE');
  });

  it('exits 1 over the budget and names the file to change', () => {
    const budget = writeBudget(1000);
    const res = run(['--budget', budget, '--dist', dist]);
    expect(res.status).toBe(1);
    expect(res.stdout + res.stderr).toContain('config/bundle-budget.json');
    expect(res.stdout).toMatch(/^Initial load: /);
  });

  it('exits 2 without index.html', () => {
    rmSync(join(dist, 'index.html'));
    const res = run(['--budget', writeBudget(100000), '--dist', dist]);
    expect(res.status).toBe(2);
  });

  it('exits 2 when a named asset is missing', () => {
    rmSync(join(dist, 'css/App.def.css'));
    const res = run(['--budget', writeBudget(100000), '--dist', dist]);
    expect(res.status).toBe(2);
  });

  it('exits 2 when an asset path leaves the dist folder', () => {
    write('index.html', '<script src=/static/pulp_ui/js/../../x.js></script>');
    const res = run(['--budget', writeBudget(100000), '--dist', dist]);
    expect(res.status).toBe(2);
  });

  it('exits 2 when index.html names a script outside a js or css folder', () => {
    write(
      'index.html',
      INDEX_UNQUOTED.replace(
        '</head>',
        '<script src=/static/pulp_ui/runtime.js></script></head>',
      ),
    );
    const res = run(['--budget', writeBudget(100000), '--dist', dist]);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/runtime\.js/);
  });

  it('exits 2 for a missing budget file, a non-numeric limit and a missing argument', () => {
    expect(
      run(['--budget', join(dist, 'nope.json'), '--dist', dist]).status,
    ).toBe(2);
    const bad = join(dist, '..', 'bad.json');
    writeFileSync(bad, JSON.stringify({ initialGzipBytes: 'lots' }));
    expect(run(['--budget', bad, '--dist', dist]).status).toBe(2);
    writeFileSync(bad, 'not json');
    expect(run(['--budget', bad, '--dist', dist]).status).toBe(2);
    expect(run(['--dist', dist]).status).toBe(2);
  });

  it('appends the same tables as Markdown to the job summary file', () => {
    const summary = join(dist, '..', 'summary.md');
    const res = run(['--budget', writeBudget(100000), '--dist', dist], {
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(res.status).toBe(0);
    expect(existsSync(summary)).toBe(true);
    const md = readFileSync(summary, 'utf8');
    expect(md).toContain('Initial load');
    expect(md).toContain('| --- |');
    expect(md).toContain('js/section.111.js');
  });
});
