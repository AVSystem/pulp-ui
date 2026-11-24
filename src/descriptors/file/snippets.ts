import { msg } from '@lingui/core/macro';
import type { SnippetDef } from 'src/framework/descriptor';
import {
  TOKEN_PLACEHOLDER,
  USER_PLACEHOLDER,
  readUrl,
} from 'src/framework/snippets/urls';
import { shellQuote } from 'src/utilities/shell-quote';

// Where the file goes in the address of a file; the reader fills it in.
const PATH = '<path>';

// The client configuration of a file distribution. Every value goes into the
// command as a quoted shell word: a name and an address are free text.
export const fileSnippets: SnippetDef[] = [
  {
    id: 'curl',
    label: msg`curl`,
    language: 'shell',
    build: (input) =>
      `curl -fSLO${input.guarded ? ` -u ${shellQuote(`${USER_PLACEHOLDER}:${TOKEN_PLACEHOLDER}`)}` : ''} ${shellQuote(`${readUrl(input)}${PATH}`)}`,
  },
  {
    id: 'wget',
    label: msg`wget`,
    language: 'shell',
    build: (input) =>
      `wget${input.guarded ? ` --user ${shellQuote(USER_PLACEHOLDER)} --ask-password` : ''} ${shellQuote(`${readUrl(input)}${PATH}`)}`,
  },
  // The manifest sits next to the content, at the distribution's address. A
  // remote is named after the repository the distribution serves.
  {
    id: 'pulp-cli',
    label: msg`CLI configuration`,
    language: 'shell',
    build: (input) =>
      `pulp file remote create --name ${shellQuote(input.repositoryName ?? input.name)} --url ${shellQuote(`${readUrl(input)}PULP_MANIFEST`)}`,
  },
];
