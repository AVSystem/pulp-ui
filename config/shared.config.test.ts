// @vitest-environment node
// The webpack settings module checks the commit the build is stamped with as
// soon as it is loaded. A short hash or a branch name would not pin a build to
// one source tree, so loading must stop with a message that names the
// variable, before any bundling starts.
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const CONFIG = require.resolve('./shared.config.js');

const VARIABLES = ['PULP_UI_COMMIT', 'PULP_UI_CONFIG', 'PULP_UI_DATE'];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(
    VARIABLES.map((name) => [name, process.env[name]]),
  );
  VARIABLES.forEach((name) => delete process.env[name]);
  delete require.cache[CONFIG];
});

afterEach(() => {
  for (const name of VARIABLES) {
    if (saved[name] === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved[name];
    }
  }
  delete require.cache[CONFIG];
});

// Loads the module afresh with the given commit in the environment.
function load(commit: string) {
  process.env['PULP_UI_COMMIT'] = commit;
  delete require.cache[CONFIG];
  return require(CONFIG);
}

describe('the build stamp commit', () => {
  it.each([
    ['a short hash', 'abc1234'],
    ['a branch name', 'main'],
    ['a hash with upper case letters', 'A'.repeat(40)],
    ['a hash one character short', 'a'.repeat(39)],
    ['a hash one character long', 'a'.repeat(41)],
    ['a hash with surrounding text', ` ${'a'.repeat(40)}`],
  ])(
    'is refused when it is %s, with a message naming PULP_UI_COMMIT',
    (_, commit) => {
      expect(() => load(commit)).toThrowError(/PULP_UI_COMMIT/);
    },
  );

  it('quotes the refused value so the mistake can be found', () => {
    expect(() => load('abc1234')).toThrowError('"abc1234"');
  });

  it('is accepted when it is a full lowercase 40-character hash', () => {
    const config = load('0123456789abcdef'.repeat(2) + '01234567');

    expect(typeof config).toBe('function');
  });
});
