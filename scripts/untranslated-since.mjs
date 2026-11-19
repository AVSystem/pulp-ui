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
// sentence at run time or shows the placeholder name to the user. A plural or
// select message is compared by the names of its arguments, never by the text
// of its branches, which is translated on purpose.
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
export class InputError extends Error {}

const CONTEXT_SEPARATOR = '\u0004';

// Joins the forms of a gettext plural entry (msgstr[0], msgstr[1], ...) into
// the one string a catalog map holds for the message.
const FORM_SEPARATOR = '\u0001';

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
 *
 * A gettext plural entry (msgid, msgid_plural, msgstr[0], msgstr[1], ...) is
 * keyed by its msgid and holds its forms joined by a separator; it holds an
 * empty translation when it has no form or any form is empty, because a user
 * of the language would then meet the source text for that count.
 */
export function parsePo(text) {
  const messages = new Map();
  let ctx = null;
  let id = null;
  let str = null;
  let forms = null;
  let field = null;

  const flush = () => {
    if (id !== null) {
      const key = ctx === null ? id : `${ctx}${CONTEXT_SEPARATOR}${id}`;
      if (key !== '') {
        if (forms !== null) {
          const empty = forms.length === 0 || forms.some((form) => form === '');
          messages.set(key, empty ? '' : forms.join(FORM_SEPARATOR));
        } else {
          messages.set(key, str ?? '');
        }
      }
    }
    ctx = null;
    id = null;
    str = null;
    forms = null;
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
    } else if (line.startsWith('msgid_plural ')) {
      // The plural source text is not a key; its forms are read below.
      forms = [];
      field = 'plural';
    } else if (line.startsWith('msgid ')) {
      if (id !== null) {
        flush();
      }
      id = unquote(line.slice('msgid '.length));
      field = 'id';
    } else if (/^msgstr\[\d+\]\s/.test(line)) {
      forms ??= [];
      forms.push(unquote(line.slice(line.indexOf(' ') + 1)));
      field = 'form';
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
      } else if (field === 'form') {
        forms[forms.length - 1] += part;
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

const ICU_BRANCHING = new Set(['plural', 'select', 'selectordinal']);

/** Index of the brace that closes the one opened at `open`, or -1. */
function closingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" && (text[i + 1] === '{' || text[i + 1] === '}')) {
      const end = text.indexOf("'", i + 1);
      i = end === -1 ? text.length : end;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * The placeholders found in ICU text, as { all, nested }: `all` lists every
 * argument and tag as it occurs, `nested` the ones found inside the branches
 * of plural and select arguments (each listed once per argument, however many
 * branches repeat it, since a language may have fewer or more branches).
 */
function scanText(text) {
  const found = [];
  let plain = '';
  const flushPlain = () => {
    found.push(...(plain.match(/<\/?\d+>/g) ?? []));
    plain = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'" && text[i + 1] === "'") {
      i += 1;
    } else if (ch === "'" && (text[i + 1] === '{' || text[i + 1] === '}')) {
      const end = text.indexOf("'", i + 1);
      i = end === -1 ? text.length : end;
    } else if (ch === '{') {
      flushPlain();
      const close = closingBrace(text, i);
      const inner = text.slice(i + 1, close === -1 ? text.length : close);
      const parts =
        /^\s*([^\s,{}]+)\s*(?:,\s*([a-zA-Z]+)\s*(?:,([\s\S]*))?)?$/.exec(inner);
      if (parts === null) {
        // Not an argument we understand: keep its text out of the comparison.
        i = close === -1 ? text.length : close;
        continue;
      }
      found.push(`{${parts[1]}}`);
      if (ICU_BRANCHING.has(parts[2]) && parts[3] !== undefined) {
        const branchTokens = new Set();
        let rest = parts[3];
        for (;;) {
          const open = rest.indexOf('{');
          if (open === -1) {
            break;
          }
          const end = closingBrace(rest, open);
          const body = rest.slice(open + 1, end === -1 ? rest.length : end);
          for (const token of scanText(body)) {
            branchTokens.add(token);
          }
          if (end === -1) {
            break;
          }
          rest = rest.slice(end + 1);
        }
        found.push(...branchTokens);
      }
      i = close === -1 ? text.length : close;
    } else {
      plain += ch;
    }
  }
  flushPlain();
  return found;
}

/**
 * The placeholders of a message, sorted: {name}, {0}, <0> and </0>. A plural
 * or select argument counts as its argument name; the arguments and tags
 * nested in its branches count once each, and the branch text counts for
 * nothing.
 */
export function placeholders(text) {
  return scanText(text).sort();
}

/**
 * The problems of a catalog for a list of ids: { id, kind } with kind
 * "untranslated" for a missing or empty translation and "placeholders" for a
 * translation whose placeholders differ from those of its id. The forms of a
 * gettext plural entry are each compared, as a set of names, with the id.
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
    const targets = translation.split(FORM_SEPARATOR);
    const differs =
      targets.length === 1
        ? source.join('\n') !== placeholders(translation).join('\n')
        : targets.some(
            (form) =>
              [...new Set(placeholders(form))].join('\n') !==
              [...new Set(source)].join('\n'),
          );
    if (differs) {
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

export function readFile(path) {
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

export const display = (id) =>
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
