#!/usr/bin/env node
// Lists every message a language catalog leaves untranslated.
//
// A message with no translation is shown in the source language, so a catalog
// that lags behind reaches its users in English. Where untranslated-since.mjs
// reports the messages added since a commit, this check reports all of them,
// for every language of lingui.config.js except the source language, so the
// size of the translation work is measured instead of estimated. A message
// counts as untranslated when its translation is missing or empty (for a
// gettext plural entry: when any form is empty). A translation whose
// placeholders differ from those of its source is listed and counted apart,
// with the same comparison as untranslated-since.mjs.
//
// Usage:
//   node scripts/untranslated.mjs [--root <dir>]
//
// Output on standard output: one line per problem, the language code, one
// space and the message id ("es Go back"), a changed placeholder as
// "es (placeholders differ) Go back"; after the lines of a language one count
// line "# es: 428 untranslated, 0 with changed placeholders, of 860 messages".
// Line breaks inside an id are written as \n. Obsolete entries ("#~") are
// ignored.
//
// Exit status: 0 when no language has a problem, 1 when at least one has, 2
// when an argument is unknown or a catalog or the configuration cannot be
// read.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  InputError,
  display,
  parsePo,
  problems,
  readFile,
  readLocales,
} from './untranslated-since.mjs';

const USAGE = 'usage: untranslated.mjs [--root <dir>]';

function parseArgs(args) {
  const options = {
    root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--root' && args[i + 1]) {
      options.root = resolve(args[i + 1]);
      i += 1;
    } else {
      throw new InputError(USAGE);
    }
  }
  return options;
}

/**
 * The report of a catalog map against the ids of the source catalog:
 * { lines, untranslated, differing } with the problem lines in source order.
 */
export function report(locale, ids, catalogMap) {
  const found = problems(ids, catalogMap);
  const lines = found.map(({ id, kind }) =>
    kind === 'placeholders'
      ? `${locale} (placeholders differ) ${display(id)}`
      : `${locale} ${display(id)}`,
  );
  return {
    lines,
    untranslated: found.filter((p) => p.kind === 'untranslated').length,
    differing: found.filter((p) => p.kind === 'placeholders').length,
  };
}

function main(args) {
  try {
    const { root } = parseArgs(args);
    const locales = readLocales(readFile(join(root, 'lingui.config.js')));
    const ids = [...parsePo(readFile(join(root, 'locale', 'en.po'))).keys()];
    const out = [];
    let any = false;
    for (const locale of locales) {
      const catalogMap = parsePo(
        readFile(join(root, 'locale', `${locale}.po`)),
      );
      const { lines, untranslated, differing } = report(
        locale,
        ids,
        catalogMap,
      );
      out.push(...lines);
      out.push(
        `# ${locale}: ${untranslated} untranslated, ${differing} with changed placeholders, of ${ids.length} messages`,
      );
      any ||= lines.length > 0;
    }
    process.stdout.write(`${out.join('\n')}\n`);
    return any ? 1 : 0;
  } catch (err) {
    if (err instanceof InputError) {
      process.stderr.write(`untranslated: ${err.message}\n`);
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
