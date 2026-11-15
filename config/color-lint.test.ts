// @vitest-environment node
// A color written outside the token file escapes the theme swap and the
// contrast checks. The lint configuration therefore rejects literal colors,
// PatternFly palette and numeric-tier variables and PatternFly 5 names in every
// stylesheet and component, and leaves src/theme/tokens.scss as the one file
// that may hold them.
import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import stylelint from 'stylelint';
import { beforeAll, describe, expect, it } from 'vitest';

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

describe('eslint color rules', () => {
  let eslint: ESLint;

  beforeAll(() => {
    eslint = new ESLint({ cwd: ROOT });
  });

  // The color-rule messages the configuration reports for the given source,
  // linted as if it lived at the given path under the repository root.
  async function reports(source: string, path = 'src/containers/page.tsx') {
    const [result] = await eslint.lintText(source, {
      filePath: resolve(ROOT, path),
    });
    return result.messages.filter(
      (message) =>
        message.ruleId === 'no-restricted-syntax' &&
        /tokens\.scss/.test(message.message),
    );
  }

  const rejected: [string, string][] = [
    ['a hex color string', "export const c = '#ff0000';"],
    [
      'a hex color in a style',
      "export const a = <div style={{ color: '#fff' }} />;",
    ],
    [
      'a named color in a style',
      "export const a = <div style={{ color: 'red' }} />;",
    ],
    [
      'rgba() in a box shadow',
      "export const a = <div style={{ boxShadow: '0 0 2px rgba(0, 0, 0, 0.2)' }} />;",
    ],
    [
      'a palette variable in a style',
      "export const a = <div style={{ color: 'var(--pf-t--color--blue--40)' }} />;",
    ],
    [
      'a dark variable in a string',
      "export const c = 'var(--pf-t--global--dark--background--color--100)';",
    ],
    [
      'a PatternFly 5 class string',
      "export const a = <div className='pf-v5-c-title' />;",
    ],
    [
      'a template literal with the PatternFly 5 prefix',
      'export const c = (x: string) => `pf-v5-c-${x}`;',
    ],
  ];

  it.each(rejected)('reports %s', async (_name, source) => {
    const found = await reports(source);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toMatch(/--pulp-/);
  });

  const accepted: [string, string][] = [
    [
      'a Pulp token in a style',
      "export const a = <div style={{ color: 'var(--pulp-text)' }} />;",
    ],
    [
      'a semantic token in a style',
      "export const a = <div style={{ background: 'var(--pf-t--global--background--color--primary--default)' }} />;",
    ],
    [
      'inherit and a unitless number',
      "export const a = <div style={{ color: 'inherit', flexGrow: 1 }} />;",
    ],
    [
      'transparent and currentColor',
      "export const a = <div style={{ background: 'transparent', borderColor: 'currentColor' }} />;",
    ],
    [
      'a PatternFly 6 class string',
      "export const a = <div className='pf-v6-c-title' />;",
    ],
  ];

  it.each(accepted)('accepts %s', async (_name, source) => {
    expect(await reports(source)).toEqual([]);
  });

  it('reports a color in a test file as well', async () => {
    const found = await reports(
      "export const c = '.pf-v5-c-spinner';",
      'src/components/x.test.tsx',
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it('keeps the response guard in force next to the color rules', async () => {
    const [result] = await eslint.lintText(
      'export const f = (api) => api.get().catch((e) => { const { status } = e.response; return status; });',
      { filePath: resolve(ROOT, 'src/containers/page.tsx') },
    );
    const guard = result.messages.filter(
      (message) =>
        message.ruleId === 'no-restricted-syntax' &&
        /requestErrorStatus/.test(message.message),
    );
    expect(guard).toHaveLength(1);
  });
});
