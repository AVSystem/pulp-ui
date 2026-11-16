#!/usr/bin/env node
// Lists the messages added since a commit that a language catalog does not
// translate.
//
// A message that has no translation in a catalog is shown in the source
// language, so a sentence added to the interface reaches users of every other
// language in English until someone translates it. This check compares the
// source catalog (locale/en.po) at a given commit with the working source
// catalog, takes the messages that are new, and reports for each language
// catalog the ones it lacks or holds with an empty translation. It also
// reports a translation that does not carry the same placeholders as its
// source ({name}, {0}, <0>...</0>), because a changed placeholder breaks the
// sentence at run time or shows the placeholder name to the user.
//
// Obsolete entries (marked "#~") are ignored in both catalogs. The languages
// are the ones listed in lingui.config.js, without the source language.
//
// Usage:
//   node scripts/untranslated-since.mjs <ref> [--root <dir>]
//
// Output: one line per problem on standard output, the language code, one
// space and the message id ("es Go back"). A translation with changed
// placeholders is printed as "es (placeholders differ) Go back". Line breaks
// inside an id are written as \n.
//
// Exit status: 0 when nothing is missing, 1 when at least one message is
// untranslated or has changed placeholders, 2 when the ref does not exist, the
// ref is missing, or a catalog or the configuration cannot be read.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Raised for input that cannot be checked; the command line maps it to 2.
class InputError extends Error {}

const CONTEXT_SEPARATOR = '\u0004';

const UNESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };

function unquote(line) {
  const match = /^"(.*)"\s*$/.exec(line);
  if (!match) {
    throw new InputError(`not a quoted catalog line: ${line}`);
  }
  return match[1].replace(/\\(.)/g, (whole, ch) => UNESCAPES[ch] ?? whole);
}

/**
 * The messages of a .po catalog as a Map from id to translation, in file
 * order. A message with a context is keyed by the context, a separator and the
 * id, so two messages with the same text stay apart. The header entry and
 * obsolete entries are skipped. Handles multi-line msgid, msgstr and msgctxt
 * and escaped quotes, backslashes and line breaks.
 */
export function parsePo(text) {
  const messages = new Map();
  let ctx = null;
  let id = null;
  let str = null;
  let field = null;

  const flush = () => {
    if (id !== null) {
      const key = ctx === null ? id : `${ctx}${CONTEXT_SEPARATOR}${id}`;
      if (key !== '') {
        messages.set(key, str ?? '');
      }
    }
    ctx = null;
    id = null;
    str = null;
    field = null;
  };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') {
      flush();
    } else if (line.startsWith('#')) {
      // comments, references and obsolete entries
    } else if (line.startsWith('msgctxt ')) {
      if (id !== null) {
        flush();
      }
      ctx = unquote(line.slice('msgctxt '.length));
      field = 'ctx';
    } else if (line.startsWith('msgid ')) {
      if (id !== null) {
        flush();
      }
      id = unquote(line.slice('msgid '.length));
      field = 'id';
    } else if (line.startsWith('msgstr ')) {
      str = unquote(line.slice('msgstr '.length));
      field = 'str';
    } else if (line.startsWith('"')) {
      const part = unquote(line);
      if (field === 'ctx') {
        ctx += part;
      } else if (field === 'id') {
        id += part;
      } else if (field === 'str') {
        str += part;
      }
    }
  }
  flush();
  return messages;
}

/** The ids of newMap that oldMap lacks, in the order of newMap. */
export function newIds(oldMap, newMap) {
  return [...newMap.keys()].filter((id) => !oldMap.has(id));
}

/** The placeholders of a message, sorted: {name}, {0}, <0> and </0>. */
export function placeholders(text) {
  return (text.match(/\{[^{}]*\}|<\/?\d+>/g) ?? []).sort();
}

/**
 * The problems of a catalog for a list of ids: { id, kind } with kind
 * "untranslated" for a missing or empty translation and "placeholders" for a
 * translation whose placeholders differ from those of its id.
 */
export function problems(ids, catalogMap) {
  const found = [];
  for (const id of ids) {
    const translation = catalogMap.get(id);
    if (translation === undefined || translation === '') {
      found.push({ id, kind: 'untranslated' });
      continue;
    }
    const source = placeholders(id.slice(id.indexOf(CONTEXT_SEPARATOR) + 1));
    const target = placeholders(translation);
    if (source.join('\n') !== target.join('\n')) {
      found.push({ id, kind: 'placeholders' });
    }
  }
  return found;
}

/**
 * The language codes of a lingui configuration, without the source language,
 * read from its text so the check needs no module resolution.
 */
export function readLocales(configText) {
  const list = /\blocales\s*:\s*\[([^\]]*)\]/.exec(configText);
  if (!list) {
    throw new InputError('lingui.config.js has no locales list');
  }
  const source = /\bsourceLocale\s*:\s*['"]([^'"]+)['"]/.exec(configText);
  const sourceLocale = source ? source[1] : 'en';
  const codes = [...list[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return codes.filter((code) => code !== sourceLocale);
}

function readFile(path) {
  if (!existsSync(path)) {
    throw new InputError(`cannot read ${path}`);
  }
  return readFileSync(path, 'utf8');
}

function sourceAt(root, ref) {
  try {
    return execFileSync('git', ['-C', root, 'show', `${ref}:locale/en.po`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new InputError(`cannot read locale/en.po at ${ref}`);
  }
}

function parseArgs(args) {
  const options = {
    ref: null,
    root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root') {
      if (!args[i + 1]) {
        throw new InputError(
          'usage: untranslated-since.mjs <ref> [--root <dir>]',
        );
      }
      options.root = resolve(args[i + 1]);
      i += 1;
    } else if (options.ref === null && !args[i].startsWith('--')) {
      options.ref = args[i];
    } else {
      throw new InputError(
        'usage: untranslated-since.mjs <ref> [--root <dir>]',
      );
    }
  }
  if (options.ref === null) {
    throw new InputError('usage: untranslated-since.mjs <ref> [--root <dir>]');
  }
  return options;
}

const display = (id) =>
  id.slice(id.indexOf(CONTEXT_SEPARATOR) + 1).replace(/\n/g, '\\n');

function main(args) {
  try {
    const { ref, root } = parseArgs(args);
    const locales = readLocales(readFile(join(root, 'lingui.config.js')));
    const added = newIds(
      parsePo(sourceAt(root, ref)),
      parsePo(readFile(join(root, 'locale', 'en.po'))),
    );
    const lines = [];
    for (const locale of locales) {
      const catalogMap = parsePo(
        readFile(join(root, 'locale', `${locale}.po`)),
      );
      for (const { id, kind } of problems(added, catalogMap)) {
        lines.push(
          kind === 'placeholders'
            ? `${locale} (placeholders differ) ${display(id)}`
            : `${locale} ${display(id)}`,
        );
      }
    }
    if (lines.length > 0) {
      process.stdout.write(`${lines.join('\n')}\n`);
      return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof InputError) {
      process.stderr.write(`untranslated-since: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
