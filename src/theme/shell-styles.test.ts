// jsdom does no layout, so rules that keep the frame usable are checked in the
// source: what they say, not how a browser lays them out.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(import.meta.dirname, 'shell.scss'), 'utf8');

function ruleBody(selector: string): string {
  const start = styles.indexOf(selector);
  expect(start, `${selector} is in shell.scss`).toBeGreaterThanOrEqual(0);
  const open = styles.indexOf('{', start);
  return styles.slice(open + 1, styles.indexOf('}', open));
}

describe('collapsed sidebar', () => {
  it('is hidden, so nothing inside it takes keyboard focus', () => {
    expect(ruleBody(':root .pf-v6-c-page__sidebar.pf-m-collapsed')).toMatch(
      /visibility:\s*hidden/,
    );
  });
});

describe('breadcrumb trail', () => {
  it('is capped at the width of the top bar cell so a long crumb is cut', () => {
    expect(ruleBody(':root .pulp-crumbs')).toMatch(/max-inline-size:\s*100%/);
  });
});
