// @vitest-environment node
// Tests of the check that lists every message a language catalog leaves
// untranslated. The command line runs against a throwaway directory that holds
// a lingui configuration and the catalogs.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'untranslated.mjs');

const HEADER = 'msgid ""\nmsgstr ""\n"Language: xx\\n"\n\n';

const catalog = (...entries) =>
  HEADER +
  entries
    .map(([id, str]) => `#: src/a.tsx\nmsgid "${id}"\nmsgstr "${str}"\n`)
    .join('\n');

describe('untranslated.mjs', () => {
  let root;
  const put = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], {
      encoding: 'utf8',
    });
  const lines = (result) => result.stdout.split('\n').filter(Boolean);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'untranslated-'));
    put(
      'lingui.config.js',
      "export default { locales: ['en', 'es', 'fr'], sourceLocale: 'en' };\n",
    );
    put(
      'locale/en.po',
      catalog(
        ['Go back', 'Go back'],
        ['Role {name}', 'Role {name}'],
        ['{count, plural, one {# task} other {# tasks}}', ''],
      ),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('lists every untranslated message per language, then a count line, and exits 1', () => {
    put(
      'locale/es.po',
      catalog(
        ['Go back', 'Volver'],
        ['Role {name}', ''],
        [
          '{count, plural, one {# task} other {# tasks}}',
          '{count, plural, one {# tarea} other {# tareas}}',
        ],
      ),
    );
    put(
      'locale/fr.po',
      catalog(['Go back', ''], ['Role {name}', ''], ['Missing', 'Absent']),
    );
    const result = run();
    expect(result.status).toBe(1);
    expect(lines(result)).toEqual([
      'es Role {name}',
      '# es: 1 untranslated, 0 with changed placeholders, of 3 messages',
      'fr Go back',
      'fr Role {name}',
      'fr {count, plural, one {# task} other {# tasks}}',
      '# fr: 3 untranslated, 0 with changed placeholders, of 3 messages',
    ]);
  });

  it('reports a changed placeholder and counts it apart', () => {
    put(
      'locale/es.po',
      catalog(
        ['Go back', 'Volver'],
        ['Role {name}', 'Rol {nombre}'],
        [
          '{count, plural, one {# task} other {# tasks}}',
          '{count, plural, one {# tarea} other {# tareas}}',
        ],
      ),
    );
    put(
      'locale/fr.po',
      catalog(
        ['Go back', 'Retour'],
        ['Role {name}', 'Role {name}'],
        [
          '{count, plural, one {# task} other {# tasks}}',
          '{count, plural, one {# tache} other {# taches}}',
        ],
      ),
    );
    const result = run();
    expect(result.status).toBe(1);
    expect(lines(result)).toEqual([
      'es (placeholders differ) Role {name}',
      '# es: 0 untranslated, 1 with changed placeholders, of 3 messages',
      '# fr: 0 untranslated, 0 with changed placeholders, of 3 messages',
    ]);
  });

  it('exits 0 with only count lines when everything is translated', () => {
    const full = catalog(
      ['Go back', 'Volver'],
      ['Role {name}', 'Rol {name}'],
      [
        '{count, plural, one {# task} other {# tasks}}',
        '{count, plural, one {# tarea} other {# tareas}}',
      ],
    );
    put('locale/es.po', full);
    put('locale/fr.po', full);
    const result = run();
    expect(result.status).toBe(0);
    expect(lines(result)).toEqual([
      '# es: 0 untranslated, 0 with changed placeholders, of 3 messages',
      '# fr: 0 untranslated, 0 with changed placeholders, of 3 messages',
    ]);
  });

  it('exits 2 when a configured language has no catalog', () => {
    put('locale/es.po', catalog(['Go back', 'Volver']));
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/fr/);
  });

  it('exits 2 for an argument it does not know', () => {
    expect(run('--bogus').status).toBe(2);
  });
});
