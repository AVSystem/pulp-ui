#!/usr/bin/env node
// Dumps the OpenAPI schema of a local Pulp image for development.
//
//   PULP_SCHEMA_IMAGE=<local image> node scripts/dump-schema.mjs <output file>
//
// The image is named only by the environment, with no default: this repository
// is public and must not carry a registry path or any other detail of where
// images are built or stored. The container runs without a network and without
// mounts, so the dump can neither depend on nor reach a running installation,
// and with a fixed hash seed, so two dumps of one image are identical. The
// output file is the input of `regenerate`; it is a working file and is never
// committed (the committed copy is written by the import).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USAGE =
  'Usage: PULP_SCHEMA_IMAGE=<image> node scripts/dump-schema.mjs <output file>';
const SOURCES_VARIABLE = 'PULP_IMAGE_SOURCES';
const MAX_SCHEMA_BYTES = 256 * 1024 * 1024;

/**
 * Builds the arguments of the docker command that prints the schema.
 * @param {string} image Image reference taken from the environment.
 * @returns {string[]} Arguments for the docker executable.
 */
export function buildDockerArgs(image) {
  return [
    'run',
    '--rm',
    '--network',
    'none',
    '-e',
    'PYTHONHASHSEED=0',
    image,
    'pulpcore-manager',
    'openapi',
    '--format',
    'openapi-json',
  ];
}

/**
 * Returns the schema with the image's source list recorded in its info.
 * @param {Record<string, any>} spec Parsed schema.
 * @param {string[]} envLines The image's environment, one KEY=VALUE per line.
 * @returns {Record<string, any>} A copy of the schema whose
 *   info["x-pulp-image-sources"] holds the value of PULP_IMAGE_SOURCES, or an
 *   empty string when the image has none.
 */
export function addImageSources(spec, envLines) {
  const prefix = `${SOURCES_VARIABLE}=`;
  const line = envLines.find((entry) => entry.startsWith(prefix));
  return {
    ...spec,
    info: {
      ...spec.info,
      'x-pulp-image-sources':
        line === undefined ? '' : line.slice(prefix.length),
    },
  };
}

function dump(image) {
  const raw = execFileSync('docker', buildDockerArgs(image), {
    maxBuffer: MAX_SCHEMA_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const env = execFileSync(
    'docker',
    [
      'image',
      'inspect',
      '--format',
      '{{range .Config.Env}}{{println .}}{{end}}',
      image,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return addImageSources(JSON.parse(raw.toString('utf8')), env.split('\n'));
}

function main(argv, env) {
  const output = argv[0];
  if (!output) {
    console.error(USAGE);
    return 2;
  }
  const image = env.PULP_SCHEMA_IMAGE;
  if (!image) {
    console.error('PULP_SCHEMA_IMAGE is not set');
    return 2;
  }
  try {
    const spec = dump(image);
    mkdirSync(dirname(resolve(output)), { recursive: true });
    writeFileSync(output, `${JSON.stringify(spec, null, 2)}\n`);
    console.log(`wrote ${output}`);
    return 0;
  } catch (error) {
    const detail = error?.stderr?.toString().trim();
    console.error(
      `the schema dump failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (detail) {
      console.error(detail);
    }
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
