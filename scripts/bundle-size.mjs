#!/usr/bin/env node
// Initial-load size check for the production build.
//
// The initial load is everything a first visit downloads before any screen
// shows: each script and stylesheet that dist/index.html names, compressed the
// way a server compresses it (gzip, level 9) and added up. It grows silently
// when a heavy import lands in the entry instead of a lazily loaded section,
// and every user then pays for it on every first visit. This check compares
// the total with the limit in a file of the repository, so raising the limit
// is a visible change in a pull request, and it reports every other chunk
// (raw and gzip size) without budgeting it.
//
// Usage:
//   node scripts/bundle-size.mjs --budget config/bundle-budget.json [--dist dist]
//
// The budget file is JSON: { "initialGzipBytes": <integer> }.
//
// Exit status: 0 within the budget, 1 over it, 2 when index.html, an asset it
// names or the budget file is missing or invalid, or an asset path would leave
// the dist folder. When GITHUB_STEP_SUMMARY names a file, the report is
// appended to it as Markdown.
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const BUDGET_FILE = 'config/bundle-budget.json';

// Raised for input that cannot be measured; the command line maps it to 2.
class InputError extends Error {}

/**
 * The initial assets named by a page: the path of every script src and link
 * href that ends in .js or .css and sits under a js or css folder, as a path
 * relative to the dist folder ("js/App.<hash>.js"), in page order, once each.
 * Handles quoted and unquoted attribute values.
 */
export function parseAssets(html) {
  const found = [];
  const attribute = /\b(?:src|href)\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+)/gi;
  for (const match of html.matchAll(attribute)) {
    const value = match[1].replace(/^["']|["']$/g, '').replace(/[?#].*$/, '');
    if (!/\.(?:js|css)$/.test(value)) {
      continue;
    }
    const tail = /(?:^|\/)((?:js|css)\/.*)$/.exec(value);
    if (tail && !found.includes(tail[1])) {
      found.push(tail[1]);
    }
  }
  return found;
}

/** Size in bytes of the buffer after gzip at the highest level. */
export function gzipSize(buffer) {
  return gzipSync(buffer, { level: 9 }).length;
}

/** Whether the total is within the budget, and by how much it is over. */
export function compare(total, budget) {
  const over = Math.max(0, total - budget);
  return { ok: over === 0, over };
}

function describeAsset(distDir, relPath) {
  let data;
  try {
    data = readFileSync(join(distDir, relPath));
  } catch {
    throw new InputError(`asset ${relPath} is missing from ${distDir}`);
  }
  return { path: relPath, raw: data.length, gzip: gzipSize(data) };
}

function listChunks(distDir) {
  const out = [];
  for (const [folder, ext] of [
    ['js', '.js'],
    ['css', '.css'],
  ]) {
    let names = [];
    try {
      names = readdirSync(join(distDir, folder), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(ext))
        .map((e) => e.name);
    } catch {
      // no such folder: nothing to list
    }
    for (const name of names.sort()) {
      out.push(`${folder}/${name}`);
    }
  }
  return out;
}

/**
 * Measure a dist folder: { total, initial, others } where initial holds the
 * assets index.html names and others every remaining script and stylesheet,
 * each as { path, raw, gzip }. Throws InputError when index.html or a named
 * asset is missing or a named asset resolves outside the dist folder.
 */
export function measure(distDir) {
  const root = resolve(distDir);
  let html;
  try {
    html = readFileSync(join(root, 'index.html'), 'utf8');
  } catch {
    throw new InputError(`${join(root, 'index.html')} not found`);
  }
  const named = parseAssets(html);
  if (named.length === 0) {
    throw new InputError('index.html names no script or stylesheet');
  }
  for (const rel of named) {
    const target = resolve(root, rel);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new InputError(`asset path ${rel} resolves outside ${root}`);
    }
  }
  const initial = named.map((rel) => describeAsset(root, rel));
  const others = listChunks(root)
    .filter((rel) => !named.includes(rel))
    .map((rel) => describeAsset(root, rel));
  const total = initial.reduce((sum, a) => sum + a.gzip, 0);
  return { total, initial, others };
}

const number = (n) => n.toLocaleString('en-US');

function textTable(title, rows) {
  const width = Math.max(5, ...rows.map((r) => r.path.length));
  const lines = [
    '',
    title,
    `${'Asset'.padEnd(width)}  ${'Raw bytes'.padStart(12)}  ${'Gzip bytes'.padStart(12)}`,
  ];
  for (const r of rows) {
    lines.push(
      `${r.path.padEnd(width)}  ${number(r.raw).padStart(12)}  ${number(r.gzip).padStart(12)}`,
    );
  }
  return lines;
}

function markdownTable(title, rows) {
  const lines = [
    '',
    `### ${title}`,
    '',
    '| Asset | Raw bytes | Gzip bytes |',
    '| --- | ---: | ---: |',
  ];
  for (const r of rows) {
    lines.push(`| ${r.path} | ${number(r.raw)} | ${number(r.gzip)} |`);
  }
  return lines;
}

/**
 * The report of a measurement against a budget, as plain text for the job log
 * and as Markdown for the job summary. The first line of the text is the
 * headline "Initial load: N bytes gzip (budget M)".
 */
export function formatReport({ total, initial, others, budget }) {
  const headline = `Initial load: ${total} bytes gzip (budget ${budget})`;
  const initialTitle = 'Initial assets (named by index.html)';
  const othersTitle = 'Other chunks (loaded on demand, not budgeted)';
  const text = [
    headline,
    ...textTable(initialTitle, initial),
    ...textTable(othersTitle, others),
    '',
  ].join('\n');
  const markdown = [
    `## Bundle size`,
    '',
    `**${headline}**`,
    ...markdownTable(initialTitle, initial),
    ...markdownTable(othersTitle, others),
    '',
  ].join('\n');
  return { text, markdown };
}

function readBudget(file) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new InputError(
      `cannot read budget file ${file}: ${err instanceof Error ? err.message : err}`,
    );
  }
  const value = parsed && parsed.initialGzipBytes;
  if (!Number.isInteger(value) || value < 0) {
    throw new InputError(
      `${file} must hold { "initialGzipBytes": <non-negative integer> }`,
    );
  }
  return value;
}

function parseArgs(args) {
  const options = { budget: null, dist: 'dist' };
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    const value = args[i + 1];
    if ((name !== '--budget' && name !== '--dist') || !value) {
      throw new InputError(
        `usage: bundle-size.mjs --budget ${BUDGET_FILE} [--dist dist]`,
      );
    }
    options[name.slice(2)] = value;
  }
  if (!options.budget) {
    throw new InputError(
      `usage: bundle-size.mjs --budget ${BUDGET_FILE} [--dist dist]`,
    );
  }
  return options;
}

function main(args) {
  try {
    const options = parseArgs(args);
    const budget = readBudget(options.budget);
    const result = measure(options.dist);
    const report = formatReport({ ...result, budget });
    process.stdout.write(report.text);
    const summary = process.env['GITHUB_STEP_SUMMARY'];
    if (summary) {
      appendFileSync(summary, report.markdown);
    }
    const verdict = compare(result.total, budget);
    if (!verdict.ok) {
      process.stderr.write(
        `The initial load is ${number(verdict.over)} bytes over the budget of ${number(budget)} bytes gzip. ` +
          `If the larger initial load is intended, change initialGzipBytes in ${BUDGET_FILE} in a pull request.\n`,
      );
      return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof InputError) {
      process.stderr.write(`bundle-size: ${err.message}\n`);
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
