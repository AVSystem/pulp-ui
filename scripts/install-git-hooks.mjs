// Points git at the committed hooks in .githooks so a fresh clone is guarded
// by scripts/check-public.mjs without any extra step. Runs as the npm
// "prepare" lifecycle script, so "npm ci" and "npm install" both install the
// hooks.
//
// It does nothing, silently, where hooks have no meaning: under CI, and
// outside a git work tree (an unpacked source archive, an image build that
// installs dependencies from a copied directory). It never fails the install.
import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function main() {
  if (process.env.CI) {
    return;
  }
  try {
    if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
      return;
    }
  } catch {
    return;
  }

  let globalPath = '';
  try {
    globalPath = git(['config', '--global', '--get', 'core.hooksPath']);
  } catch {
    // No global hooks path is the normal case.
  }

  try {
    git(['config', 'core.hooksPath', '.githooks']);
  } catch {
    return;
  }
  process.stdout.write('git hooks installed: core.hooksPath is .githooks\n');
  if (globalPath) {
    process.stdout.write(
      'note: a global core.hooksPath exists; the repository setting overrides it here\n',
    );
  }
}

main();
