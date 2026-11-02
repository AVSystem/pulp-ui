// @vitest-environment node
// A request that never got an answer has no response, so a catch handler that
// destructures the response throws from inside itself. The lint configuration
// forbids both ways of destructuring it and leaves the request error helpers,
// which read it with a guard, as the one allowed reader.
import { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const HELPER = 'src/utilities/request-error.ts';

let eslint: ESLint;

beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT });
});

// The rule messages the configuration reports for the given source, linted as
// if it lived at the given path under the repository root.
async function reports(source: string, path = 'src/containers/page.tsx') {
  const [result] = await eslint.lintText(source, {
    filePath: resolve(ROOT, path),
  });
  return result.messages.filter(
    (message) => message.ruleId === 'no-restricted-syntax',
  );
}

describe('the rule against destructuring the response of an error', () => {
  it('reports a variable destructured from the response', async () => {
    const found = await reports(
      `export function load(api) {
         return api.get().catch((e) => {
           const { status, statusText } = e.response;
           return status + statusText;
         });
       }`,
    );

    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(3);
    expect(found[0].message).toMatch(/requestErrorStatus/);
  });

  it('reports a variable destructured from an optional response', async () => {
    const found = await reports(
      `export function load(api) {
         return api.get().catch((e) => {
           const { status } = e?.response;
           return status;
         });
       }`,
    );

    expect(found).toHaveLength(1);
  });

  it('reports a catch callback that destructures the response in its parameter', async () => {
    const found = await reports(
      `export function load(api) {
         return api.get().catch(({ response: { status, statusText } }) => {
           return status + statusText;
         });
       }`,
    );

    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
    expect(found[0].message).toMatch(/requestErrorText/);
  });

  it('accepts reading the status through an optional chain', async () => {
    const found = await reports(
      `export function load(api) {
         return api.get().catch((e) => e?.response?.status ?? null);
       }`,
    );

    expect(found).toEqual([]);
  });

  it('accepts building a synthetic rejection that carries a response', async () => {
    const found = await reports(
      `export function missing() {
         return Promise.reject({ response: { status: 404 } });
       }`,
    );

    expect(found).toEqual([]);
  });

  it('accepts the guarded read in the request error helper', async () => {
    const source = readFileSync(resolve(ROOT, HELPER), 'utf8');

    expect(await reports(source, HELPER)).toEqual([]);
  });

  it('leaves the helper itself free to read the response', async () => {
    const source = `export function status(e) {
         const { status } = e.response;
         return status;
       }`;

    expect(await reports(source, HELPER)).toEqual([]);
    expect(await reports(source)).toHaveLength(1);
  });
}, 60000);
