// @vitest-environment node
// Tests of the untranslated-messages check. Catalog fixtures are strings; the
// command line runs against a throwaway git repository that holds a source
// catalog at a base commit and working catalogs next to it.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  newIds,
  parsePo,
  placeholders,
  problems,
  readLocales,
} from './untranslated-since.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, 'untranslated-since.mjs');

const HEADER = 'msgid ""\nmsgstr ""\n"Language: xx\\n"\n\n';

const catalog = (...entries) =>
  HEADER +
  entries
    .map(([id, str]) => `#: src/a.tsx\nmsgid "${id}"\nmsgstr "${str}"\n`)
    .join('\n');

describe('parsePo', () => {
  it('reads single-line entries and skips the header', () => {
    const map = parsePo(catalog(['Go back', 'Volver'], ['Sign in', '']));
    expect([...map]).toEqual([
      ['Go back', 'Volver'],
      ['Sign in', ''],
    ]);
  });

  it('joins multi-line msgid and msgstr', () => {
    const text =
      HEADER +
      'msgid ""\n"A long "\n"sentence."\nmsgstr ""\n"Una frase "\n"larga."\n';
    expect([...parsePo(text)]).toEqual([
      ['A long sentence.', 'Una frase larga.'],
    ]);
  });

  it('unescapes quotes, backslashes and newlines', () => {
    const text =
      HEADER + 'msgid "Say \\"hi\\"\\\\ now\\n"\nmsgstr "Di \\"hola\\""\n';
    expect([...parsePo(text)]).toEqual([['Say "hi"\\ now\n', 'Di "hola"']]);
  });

  it('ignores obsolete entries', () => {
    const text =
      HEADER +
      '#~ msgid "Old"\n#~ msgstr "Viejo"\n\nmsgid "New"\nmsgstr "Nuevo"\n';
    expect([...parsePo(text)]).toEqual([['New', 'Nuevo']]);
  });

  it('keeps a message with the same text and a different context apart', () => {
    const text =
      HEADER +
      'msgctxt "menu"\nmsgid "Open"\nmsgstr "Abrir"\n\nmsgid "Open"\nmsgstr "Abierto"\n';
    expect(parsePo(text).size).toBe(2);
  });
});

describe('parsePo with gettext plural entries', () => {
  const plural = (forms, rest = '') =>
    HEADER +
    'msgid "One file"\nmsgid_plural "{count} files"\n' +
    forms.map((form, n) => `msgstr[${n}] "${form}"\n`).join('') +
    rest;

  it('reads the forms of a plural entry and joins them', () => {
    const map = parsePo(plural(['Un archivo', '{count} archivos']));
    expect([...map]).toEqual([
      ['One file', 'Un archivo\u0001{count} archivos'],
    ]);
  });

  it('holds an empty translation when any form is empty', () => {
    const map = parsePo(plural(['Un archivo', '']));
    expect([...map]).toEqual([['One file', '']]);
  });

  it('joins continuation lines to the form they follow, not to the id', () => {
    const text =
      HEADER +
      'msgid "One file"\nmsgid_plural "Many "\n"files"\n' +
      'msgstr[0] "Un "\n"archivo"\nmsgstr[1] "Muchos"\n';
    expect([...parsePo(text)]).toEqual([
      ['One file', 'Un archivo\u0001Muchos'],
    ]);
  });

  it('keeps the entries after a plural entry intact', () => {
    const map = parsePo(
      plural(
        ['Un archivo', '{count} archivos'],
        '\nmsgid "Go back"\nmsgstr "Volver"\n',
      ),
    );
    expect([...map.keys()]).toEqual(['One file', 'Go back']);
    expect(map.get('Go back')).toBe('Volver');
  });
});

describe('newIds', () => {
  it('lists the ids of the new catalog that the old one lacks, in order', () => {
    const oldMap = parsePo(catalog(['A', 'A'], ['B', 'B']));
    const newMap = parsePo(
      catalog(['A', 'A'], ['C', 'C'], ['B', 'B'], ['D', 'D']),
    );
    expect(newIds(oldMap, newMap)).toEqual(['C', 'D']);
  });

  it('lists nothing when nothing was added', () => {
    const map = parsePo(catalog(['A', 'A']));
    expect(newIds(map, map)).toEqual([]);
  });
});

describe('placeholders', () => {
  it('collects named, numbered and tag placeholders', () => {
    expect(placeholders('{name} v{version} <0>x</0> {0}')).toEqual(
      ['</0>', '<0>', '{0}', '{name}', '{version}'].sort(),
    );
  });

  it('returns an empty list for plain text', () => {
    expect(placeholders('Go back')).toEqual([]);
  });

  it('names a plural by its argument only, not by its branch text', () => {
    expect(
      placeholders(
        '{0, plural, =0 {No results} one {# result} other {# results}}',
      ),
    ).toEqual(['{0}']);
  });

  it('names a select by its argument only', () => {
    expect(
      placeholders('{kind, select, repo {A repository} other {Something}}'),
    ).toEqual(['{kind}']);
  });

  it('collects arguments and tags nested in the branches once', () => {
    expect(
      placeholders(
        '{count, plural, one {Failed for "{name}".} other {Failed for "{name}" <0>now</0>.}}',
      ),
    ).toEqual(['</0>', '<0>', '{count}', '{name}']);
  });

  it('collects the arguments around a plural', () => {
    expect(
      placeholders(
        '{user}: {count, plural, one {# task} other {# tasks}} <0/>',
      ),
    ).toEqual(['{count}', '{user}']);
  });

  it('names a formatted argument by its name', () => {
    expect(placeholders('{when, date, short} {n, number}')).toEqual([
      '{n}',
      '{when}',
    ]);
  });

  it('ignores a brace quoted with an apostrophe', () => {
    expect(placeholders("Type '{' to start {name}")).toEqual(['{name}']);
  });

  it('does not fail on an unbalanced brace', () => {
    expect(placeholders('Broken {name')).toEqual(['{name}']);
  });
});

describe('problems', () => {
  const ids = ['Go back', 'Role {name}'];

  it('reports an id the catalog lacks', () => {
    const cat = parsePo(catalog(['Go back', 'Volver']));
    expect(problems(ids, cat)).toEqual([
      { id: 'Role {name}', kind: 'untranslated' },
    ]);
  });

  it('reports an id whose translation is empty', () => {
    const cat = parsePo(
      catalog(['Go back', ''], ['Role {name}', 'Rol {name}']),
    );
    expect(problems(ids, cat)).toEqual([
      { id: 'Go back', kind: 'untranslated' },
    ]);
  });

  it('reports a translation that changes the placeholders', () => {
    const cat = parsePo(
      catalog(['Go back', 'Volver'], ['Role {name}', 'Rol {nombre}']),
    );
    expect(problems(ids, cat)).toEqual([
      { id: 'Role {name}', kind: 'placeholders' },
    ]);
  });

  it('accepts a correct translation of a plural', () => {
    const id = '{0, plural, =0 {No results} one {# result} other {# results}}';
    const cat = parsePo(
      catalog([
        id,
        '{0, plural, =0 {Sin resultados} one {# resultado} other {# resultados}}',
      ]),
    );
    expect(problems([id], cat)).toEqual([]);
  });

  it('accepts a translation that has fewer plural branches', () => {
    const id =
      '{count, plural, one {# task for {name}} other {# tasks for {name}}}';
    const cat = parsePo(
      catalog([id, '{count, plural, other {# tareas para {name}}}']),
    );
    expect(problems([id], cat)).toEqual([]);
  });

  it('reports a plural translation that drops an argument inside a branch', () => {
    const id =
      '{0, plural, one {Failed to add a collection to {repositoryName}.} other {Failed to add collections to {repositoryName}.}}';
    const cat = parsePo(
      catalog([
        id,
        '{0, plural, one {No se pudo agregar una coleccion.} other {No se pudo agregar colecciones.}}',
      ]),
    );
    expect(problems([id], cat)).toEqual([{ id, kind: 'placeholders' }]);
  });

  it('reports a plural translation that renames the counted argument', () => {
    const id = '{count, plural, one {# task} other {# tasks}}';
    const cat = parsePo(
      catalog([id, '{n, plural, one {# tarea} other {# tareas}}']),
    );
    expect(problems([id], cat)).toEqual([{ id, kind: 'placeholders' }]);
  });

  it('reports an empty gettext plural entry as untranslated and compares the forms of a full one', () => {
    const text =
      HEADER +
      'msgid "{count} file"\nmsgid_plural "{count} files"\nmsgstr[0] "{count} archivo"\nmsgstr[1] "{total} archivos"\n\n' +
      'msgid "One tag"\nmsgid_plural "Tags"\nmsgstr[0] "Una etiqueta"\nmsgstr[1] ""\n';
    const cat = parsePo(text);
    expect(problems(['{count} file', 'One tag'], cat)).toEqual([
      { id: '{count} file', kind: 'placeholders' },
      { id: 'One tag', kind: 'untranslated' },
    ]);
  });

  it('accepts a complete catalog', () => {
    const cat = parsePo(
      catalog(['Go back', 'Volver'], ['Role {name}', 'Rol {name}']),
    );
    expect(problems(ids, cat)).toEqual([]);
  });
});

describe('readLocales', () => {
  it('reads the locale list of the lingui configuration without the source locale', () => {
    const config =
      "export default defineConfig({ locales: ['en', 'es', 'fr'], sourceLocale: 'en' });";
    expect(readLocales(config)).toEqual(['es', 'fr']);
  });

  it('rejects a configuration without a locale list', () => {
    expect(() => readLocales('export default {};')).toThrow(/locales/);
  });
});

describe('command line', () => {
  let root;
  const git = (...args) =>
    spawnSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@example.com',
        ...args,
      ],
      {
        encoding: 'utf8',
      },
    );
  const put = (rel, text) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  };
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], {
      encoding: 'utf8',
    });
  let base;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'untranslated-since-'));
    git('init', '-q');
    put(
      'lingui.config.js',
      "export default { locales: ['en', 'es', 'fr'], sourceLocale: 'en' };\n",
    );
    put('locale/en.po', catalog(['Old', 'Old']));
    put('locale/es.po', catalog(['Old', '']));
    put('locale/fr.po', catalog(['Old', '']));
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    base = git('rev-parse', 'HEAD').stdout.trim();
    put(
      'locale/en.po',
      catalog(
        ['Old', 'Old'],
        ['Go back', 'Go back'],
        ['Role {name}', 'Role {name}'],
      ),
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('prints one line per language and id and exits 1 when messages are untranslated', () => {
    put('locale/es.po', catalog(['Old', ''], ['Go back', 'Volver']));
    put('locale/fr.po', catalog(['Old', '']));
    const result = run(base);
    expect(result.status).toBe(1);
    expect(result.stdout.split('\n').filter(Boolean)).toEqual([
      'es Role {name}',
      'fr Go back',
      'fr Role {name}',
    ]);
  });

  it('does not report messages that existed at the base commit', () => {
    put(
      'locale/es.po',
      catalog(['Go back', 'Volver'], ['Role {name}', 'Rol {name}']),
    );
    put(
      'locale/fr.po',
      catalog(['Go back', 'Retour'], ['Role {name}', 'Role {name}']),
    );
    const result = run(base);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 1 for a translation that changes a placeholder', () => {
    put(
      'locale/es.po',
      catalog(['Go back', 'Volver'], ['Role {name}', 'Rol {nombre}']),
    );
    put(
      'locale/fr.po',
      catalog(['Go back', 'Retour'], ['Role {name}', 'Role {name}']),
    );
    const result = run(base);
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe('es (placeholders differ) Role {name}');
  });

  it('exits 2 for a ref that does not exist', () => {
    const result = run('no-such-ref');
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/no-such-ref/);
  });

  it('exits 2 without a ref', () => {
    expect(run().status).toBe(2);
  });

  it('exits 2 when a configured language has no catalog', () => {
    rmSync(join(root, 'locale/fr.po'));
    put(
      'locale/es.po',
      catalog(['Go back', 'Volver'], ['Role {name}', 'Rol {name}']),
    );
    const result = run(base);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/fr/);
  });
});
