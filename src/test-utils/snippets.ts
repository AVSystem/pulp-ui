import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

let empty: string | undefined;

const emptyDirectory = (): string =>
  (empty ??= mkdtempSync(join(tmpdir(), 'snippet-words-')));

// The words a POSIX shell reads out of the arguments part of a command line:
// what it does with quotes, substitutions and separators, so a test can prove
// that a hostile value arrives as one word of data. The line is never run as a
// command; it is only handed to printf as arguments.
export function shellWords(commandLine: string): string[] {
  // An empty directory, so a glob in the line matches nothing and stays as
  // typed.
  const output = execFileSync(
    '/bin/sh',
    ['-c', `printf '%s\\0' ${commandLine}`],
    { encoding: 'utf8', cwd: emptyDirectory() },
  );

  return output.split('\0').slice(0, -1);
}

// Opens the row of a distribution on the Distributions tab to show its client
// snippets, and selects the snippet tab when one is named.
export async function openSnippets(
  user: UserEvent,
  distribution: string,
  tab?: string,
): Promise<void> {
  const row = (await screen.findByText(distribution)).closest(
    'tr',
  ) as HTMLElement;

  await user.click(within(row).getByRole('button', { name: /details/i }));
  if (tab !== undefined) {
    await user.click(await screen.findByRole('tab', { name: tab }));
  }
}
