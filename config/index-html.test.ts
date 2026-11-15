// @vitest-environment node
// The page template. Without a viewport declaration a phone lays the page out
// at a desktop width and scales it down, so no rule for a narrow screen ever
// applies there.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const template = readFileSync(
  resolve(import.meta.dirname, '../src/index.html'),
  'utf8',
);

describe('the page template', () => {
  it('lays the page out at the width of the device', () => {
    expect(template).toMatch(
      /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1"\s*\/?>/,
    );
  });

  it('leaves the user free to zoom', () => {
    expect(template).not.toMatch(/user-scalable|maximum-scale/);
  });
});
