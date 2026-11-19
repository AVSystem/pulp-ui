#!/usr/bin/env node
// Turns a dumped Pulp OpenAPI schema into the committed generation inputs.
//
//   node scripts/import-schema.mjs <schema file>
//
// writes schema/pulp.json (normalised) and pulp-versions.json next to this
// script's package. The schema is read from a file that a Pulp image dumped
// once, never from a running installation, so the committed schema describes
// exactly the versions the image carries and nothing about where it runs.
//
// Normalising keeps the committed file stable: the only host-specific value of
// a dump (the servers entry) is dropped, and object keys are sorted, because
// the dump's property order varies between runs. The versions file records the
// application versions the schema declares and the source commits the image
// was built from; it carries no timestamp, so importing the same dump twice
// gives identical bytes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USAGE = 'Usage: node scripts/import-schema.mjs <schema file>';
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Copies a JSON value with every object's keys in code unit order. Arrays keep
 * their order, because their order is part of the meaning (parameter lists,
 * required lists, enumerations).
 * @param {unknown} value Parsed JSON value.
 * @returns {unknown} The same value with sorted object keys.
 */
export function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

/**
 * Returns the schema without its servers entry and with sorted keys.
 * @param {Record<string, unknown>} spec Parsed schema.
 * @returns {unknown} Normalised schema.
 */
export function normalise(spec) {
  const rest = { ...spec };
  delete rest.servers;
  return sortKeys(rest);
}

/**
 * Splits the image's source list ("name@commit name@commit ...") into a map.
 * @param {unknown} list The x-pulp-image-sources value, a space separated list.
 * @returns {Record<string, string>} Commit per source name, keys sorted.
 */
export function parseSources(list) {
  if (list === undefined || list === null || list === '') {
    return {};
  }
  if (typeof list !== 'string') {
    throw new Error('x-pulp-image-sources is not a string');
  }
  const pairs = {};
  for (const entry of list.split(/\s+/).filter(Boolean)) {
    const at = entry.lastIndexOf('@');
    if (at <= 0 || at === entry.length - 1) {
      throw new Error(
        `x-pulp-image-sources entry is not name@commit: ${entry}`,
      );
    }
    pairs[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return sortKeys(pairs);
}

/**
 * Builds the contents of pulp-versions.json from a schema.
 * @param {Record<string, any>} spec Parsed schema.
 * @returns {{ apps: Record<string, string>, sources: Record<string, string> }}
 *   Application versions and source commits; throws when the schema declares
 *   no application versions.
 */
export function versionsOf(spec) {
  const apps = spec?.info?.['x-pulp-app-versions'];
  if (apps === undefined || apps === null || typeof apps !== 'object') {
    throw new Error('info["x-pulp-app-versions"] is missing from the schema');
  }
  return {
    apps: sortKeys(apps),
    sources: parseSources(spec.info['x-pulp-image-sources']),
  };
}

const text = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * Reads a dumped schema and writes the committed schema and versions files.
 * @param {string} file Path of the dumped schema.
 * @param {string} root Package root that receives schema/ and pulp-versions.json.
 * @returns {{ schema: string, versions: string }} The paths written.
 */
export function importSchema(file, root = PACKAGE_ROOT) {
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const versions = versionsOf(spec);
  const schemaPath = join(root, 'schema', 'pulp.json');
  const versionsPath = join(root, 'pulp-versions.json');
  mkdirSync(dirname(schemaPath), { recursive: true });
  writeFileSync(schemaPath, text(normalise(spec)));
  writeFileSync(versionsPath, text(versions));
  return { schema: schemaPath, versions: versionsPath };
}

function main(argv) {
  const file = argv[0];
  if (!file) {
    console.error(USAGE);
    return 2;
  }
  try {
    const written = importSchema(file);
    console.log(`wrote ${written.schema}`);
    console.log(`wrote ${written.versions}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
