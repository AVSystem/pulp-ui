import { msg } from '@lingui/core/macro';
import type { SnippetDef } from 'src/framework/descriptor';
import { readUrl } from 'src/framework/snippets/urls';
import { shellQuote } from 'src/utilities/shell-quote';

export const debSnippets: SnippetDef[] = [
  // A remote needs the suites to sync, which only the user knows, so the
  // command leaves them to be filled in.
  {
    id: 'pulp-cli',
    label: msg`CLI configuration`,
    language: 'shell',
    build: (input) =>
      `pulp deb remote create --name ${shellQuote(input.repositoryName ?? input.name)} --url ${shellQuote(readUrl(input))} --distributions '<suite>'`,
  },
];
