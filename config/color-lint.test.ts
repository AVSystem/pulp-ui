// @vitest-environment node
// A color written outside the token file escapes the theme swap and the
// contrast checks. The lint configuration therefore rejects literal colors,
// PatternFly palette and numeric-tier variables and PatternFly 5 names in every
// stylesheet and component, and leaves src/theme/tokens.scss as the one file
// that may hold them.
import { resolve } from 'node:path';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const CONFIG = resolve(ROOT, '.stylelintrc.json');

// The stylelint warnings for the given source, linted as if it lived at the
// given path under the repository root.
async function problems(code: string, path = 'src/components/x.scss') {
  const result = await stylelint.lint({
    code,
    codeFilename: resolve(ROOT, path),
    configFile: CONFIG,
  });
  return result.results[0].warnings;
}

describe('stylelint color rules', () => {
  const rejected: [string, string][] = [
    ['a hex color', '.a { color: #fff; }'],
    ['a long hex color', '.a { background: #1a2b3c; }'],
    ['a named color', '.a { color: red; }'],
    ['rgb()', '.a { color: rgb(1, 2, 3); }'],
    ['rgba()', '.a { box-shadow: 0 0 2px rgba(0, 0, 0, 0.2); }'],
    ['hsl()', '.a { color: hsl(10 20% 30%); }'],
    ['oklch()', '.a { color: oklch(0.5 0.1 200); }'],
    ['color-mix()', '.a { color: color-mix(in srgb, red 50%, blue); }'],
    ['a hex value in a custom property', '.a { --local: #abcdef; }'],
    [
      'a PatternFly palette variable',
      '.a { color: var(--pf-t--color--blue--40); }',
    ],
    [
      'a PatternFly dark variable',
      '.a { color: var(--pf-t--global--dark--background--color--100); }',
    ],
    [
      'a numeric-tier global',
      '.a { background: var(--pf-t--global--background--color--100); }',
    ],
    [
      'the codemod stand-in token',
      '.a { color: var(--pf-t--temp--dev--tbd); }',
    ],
    [
      'a PatternFly 5 variable',
      '.a { color: var(--pf-v5-global--Color--100); }',
    ],
  ];

  it.each(rejected)('reports %s', async (_name, code) => {
    expect((await problems(code)).length).toBeGreaterThan(0);
  });

  const accepted: [string, string][] = [
    ['transparent', '.a { background: transparent; }'],
    ['currentcolor', '.a { border-color: currentcolor; }'],
    ['a Pulp token', '.a { color: var(--pulp-text); }'],
    [
      'a PatternFly 6 semantic token',
      '.a { color: var(--pf-t--global--text--color--regular); }',
    ],
    [
      'a component variable set to a token',
      '.a { --pf-v6-c-label--BackgroundColor: var(--pulp-sunken); }',
    ],
    ['inherit', '.a { color: inherit; }'],
  ];

  it.each(accepted)('accepts %s', async (_name, code) => {
    expect(await problems(code)).toEqual([]);
  });

  it('accepts the same forbidden values in the token file', async () => {
    const code = `:root {
  --pulp-primary: #0f6cbd;
  --pulp-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  --pulp-named: red;
  --pulp-mix: color-mix(in srgb, red 50%, blue);
  --pf-t--global--background--color--primary--default: var(--pf-t--color--blue--40);
}`;
    expect(await problems(code, 'src/theme/tokens.scss')).toEqual([]);
  });

  it('still applies the other stylesheet rules', async () => {
    const found = await problems('.a { --Bad_Name: 1px; }');
    expect(found.map((w) => w.rule)).toContain('custom-property-pattern');
  });
});
