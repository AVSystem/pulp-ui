#!/usr/bin/env node
// Regenerates the whole sdk from a dumped Pulp schema with one command.
//
//   npm run regenerate -w @pulp-ui/sdk -- <dumped schema file>
//
// Runs, in order and stopping at the first failure: the schema import (writes
// schema/pulp.json and pulp-versions.json), the generation of every
// application's clients and models, and the build of the package. Nothing here
// contacts a server: the schema is a file, and generation reads only the
// committed copy of it.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USAGE =
  'Usage: npm run regenerate -w @pulp-ui/sdk -- <dumped schema file>';
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Lists the commands of one regeneration, in the order they run.
 * @param {string} file Absolute path of the dumped schema.
 * @returns {{ label: string, command: string, args: string[] }[]} Steps.
 */
export function stepsFor(file) {
  return [
    {
      label: 'import the schema',
      command: process.execPath,
      args: [join(PACKAGE_ROOT, 'scripts', 'import-schema.mjs'), file],
    },
    {
      label: 'generate every application',
      command: 'npm',
      args: ['run', 'generate'],
    },
    { label: 'build the package', command: 'npm', args: ['run', 'build'] },
  ];
}

function main(argv) {
  const file = argv[0];
  if (!file) {
    console.error(USAGE);
    return 2;
  }
  for (const step of stepsFor(resolve(file))) {
    console.log(`regenerate: ${step.label}`);
    const result = spawnSync(step.command, step.args, {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      console.error(`regenerate: failed to ${step.label}`);
      return result.status ?? 1;
    }
  }
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
