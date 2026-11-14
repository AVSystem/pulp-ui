// @vitest-environment node
// The palette lives in one stylesheet and a rebrand edits its values. A value
// edit that drops a text pair below WCAG AA (4.5:1, or 3:1 for the border of a
// control) would hide text or control boundaries from some users in one theme
// without any other test noticing, so every pair is computed from the file
// itself, in the light and in the dark palette.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOKEN_FILE = resolve(import.meta.dirname, '../src/theme/tokens.scss');

type Palette = Record<string, string>;

// The declarations of the block whose selector is exactly the given one (a
// selector list that merely ends with it does not count).
function declarations(source: string, selector: string): Palette {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const opening = new RegExp(`^${escaped} \\{`, 'm').exec(source);
  if (!opening) {
    throw new Error(`no block for ${selector} in the token file`);
  }
  const bodyStart = opening.index + opening[0].length;
  const body = source.slice(bodyStart, source.indexOf('}', bodyStart));
  const palette: Palette = {};
  for (const match of body.matchAll(/^\s*(--pulp-[a-z0-9-]+):\s*([^;]+);/gm)) {
    palette[match[1]] = match[2].replace(/\s+/g, ' ').trim();
  }
  return palette;
}

const source = readFileSync(TOKEN_FILE, 'utf8');
const light = declarations(source, ':root');
const dark = declarations(source, ':root.pf-v6-theme-dark');

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(`not a six digit hex color: ${hex}`);
  }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// foreground token, background token, floor
const PAIRS: [string, string, number][] = [
  ['text', 'bg', 4.5],
  ['text', 'surface', 4.5],
  ['text-2', 'nav', 4.5],
  ['text-3', 'nav', 4.5],
  ['text', 'nav-active', 4.5],
  ['on-primary', 'primary', 4.5],
  ['primary', 'surface', 4.5],
  ['primary', 'primary-soft', 4.5],
  ['link', 'bg', 4.5],
  ['on-signal', 'signal', 4.5],
  ['signal-text', 'signal-soft', 4.5],
  ['ok', 'ok-soft', 4.5],
  ['bad', 'bad-soft', 4.5],
  ['code-text', 'code', 4.5],
  ['brand-text', 'brand', 4.5],
  ['line-strong', 'surface', 3.0],
];

describe('the token file', () => {
  it('declares the same tokens in the light and in the dark palette', () => {
    expect(Object.keys(light).length).toBeGreaterThan(20);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('declares a value for every token', () => {
    for (const palette of [light, dark]) {
      for (const [name, value] of Object.entries(palette)) {
        expect(value, name).not.toBe('');
      }
    }
  });
});

describe.each([
  ['light', light],
  ['dark', dark],
])('contrast in the %s palette', (_name, palette) => {
  it.each(PAIRS)('%s on %s reaches %d:1', (fg, bg, floor) => {
    const foreground = palette[`--pulp-${fg}`];
    const background = palette[`--pulp-${bg}`];
    expect(foreground, `--pulp-${fg}`).toBeDefined();
    expect(background, `--pulp-${bg}`).toBeDefined();
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(floor);
  });
});
