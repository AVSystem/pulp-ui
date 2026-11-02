// @vitest-environment node
// A production build shows a message literally (its hash) when the compiled
// catalog has no entry for it, so every message the source uses must be in the
// compiled catalog of each language. The compiled files are committed and the
// release build reads them as they are; they do not follow the source on their
// own.
import { getCatalogs } from '@lingui/cli/api';
import { getConfig } from '@lingui/conf';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const config = getConfig({
  configPath: require.resolve('../lingui.config.js'),
});

const HOW_TO_FIX =
  'Run "npm run gettext:extract" and "npm run gettext:compile" and commit the files under locale/.';

describe('compiled message catalogs', () => {
  it('has an entry for every message the source uses, in every language', async () => {
    const [catalog] = await getCatalogs(config);
    const used = await catalog?.collect();
    expect(used, 'messages found in the source').toBeDefined();

    const missing = config.locales.flatMap((locale) => {
      const { messages } = require(`../locale/${locale}.js`) as {
        messages: Record<string, unknown>;
      };
      return Object.entries(used ?? {})
        .filter(([id]) => !(id in messages))
        .map(([, { message }]) => `${locale}: ${message}`);
    });

    expect(missing, HOW_TO_FIX).toEqual([]);
  }, 60_000);
});
