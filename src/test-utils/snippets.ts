import { execFileSync } from 'node:child_process';
import type { SnippetInput } from 'src/framework/descriptor';

// A distribution as the snippet builders read it, with the reserved example
// host. A test overrides what it is about.
export function snippetInput(
  override: Partial<SnippetInput> = {},
): SnippetInput {
  return {
    name: 'manuals',
    basePath: 'docs/manuals',
    url: 'https://pulp.example.com/pulp/content/docs/manuals/',
    guarded: false,
    entry: null,
    origin: 'https://pulp.example.com',
    repositoryName: 'manuals-repo',
    ...override,
  };
}

// The words a POSIX shell reads out of the arguments part of a command line:
// what it does with quotes, substitutions and separators, so a test can prove
// that a hostile value arrives as one word of data. The line is never run as a
// command; it is only handed to printf as arguments.
export function shellWords(commandLine: string): string[] {
  const output = execFileSync(
    '/bin/sh',
    ['-c', `printf '%s\\0' ${commandLine}`],
    { encoding: 'utf8' },
  );

  return output.split('\0').slice(0, -1);
}
