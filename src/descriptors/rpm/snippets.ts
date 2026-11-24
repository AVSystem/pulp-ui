import { msg } from '@lingui/core/macro';
import type { SnippetDef } from 'src/framework/descriptor';
import { readUrl } from 'src/framework/snippets/urls';
import { shellQuote } from 'src/utilities/shell-quote';

export const rpmSnippets: SnippetDef[] = [
  {
    id: 'pulp-cli',
    label: msg`CLI configuration`,
    language: 'shell',
    build: (input) =>
      `pulp rpm remote create --name ${shellQuote(input.repositoryName ?? input.name)} --url ${shellQuote(readUrl(input))}`,
  },
];
